"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";

var items = require("./items");
var api = require("./api");

function makeMemoryDeps() {
  var store = new Map();
  return {
    store: store,
    doc: {
      send: async function (command) {
        var name = command.constructor.name;
        if (name === "PutCommand") {
          var item = command.input.Item;
          store.set(item.pk + "|" + item.sk, JSON.parse(JSON.stringify(item)));
          return {};
        }
        if (name === "GetCommand") {
          var key = command.input.Key;
          return { Item: store.get(key.pk + "|" + key.sk) };
        }
        if (name === "DeleteCommand") {
          var del = command.input.Key;
          store.delete(del.pk + "|" + del.sk);
          return {};
        }
        if (name === "QueryCommand") {
          var rows = [];
          var pk = command.input.ExpressionAttributeValues[":pk"];
          var skPrefix = command.input.ExpressionAttributeValues[":sk"];
          for (var value of store.values()) {
            if (value.pk !== pk) continue;
            if (skPrefix && String(value.sk).indexOf(skPrefix) !== 0) continue;
            rows.push(value);
          }
          return { Items: rows };
        }
        throw new Error("unexpected command " + name);
      },
    },
    s3: {
      send: async function () {
        return {};
      },
    },
    sign: async function (_client, command) {
      var key = command.input.Key;
      if (command.constructor.name === "PutObjectCommand") {
        return "https://upload.example/" + key;
      }
      return "https://read.example/" + key;
    },
  };
}

function attrs() {
  return {
    type: "jacket",
    color: "navy",
    fabric: "wool",
    brandModel: "Example Co. Blazer",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
  };
}

test("catalog CRUD happy path", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [{ contentType: "image/jpeg" }],
      })
    ),
  });
  assert.equal(created.statusCode, 201);
  var createdBody = JSON.parse(created.body);
  assert.ok(createdBody.item.itemId);
  assert.equal(createdBody.item.type, "jacket");
  assert.equal(createdBody.uploads.length, 1);
  assert.match(createdBody.uploads[0].uploadUrl, /^https:\/\/upload\.example\//);

  var itemId = createdBody.item.itemId;
  var photoId = createdBody.uploads[0].photoId;

  var confirmed = await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoId] }),
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(JSON.parse(confirmed.body).item.photos[0].status, "ready");

  var listed = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "GET", path: "/api/items" } },
    queryStringParameters: { q: "navy" },
  });
  assert.equal(listed.statusCode, 200);
  var listBody = JSON.parse(listed.body);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].itemId, itemId);
  assert.ok(listBody.items[0].photos[0].url);

  var updated = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ color: "charcoal" }),
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(JSON.parse(updated.body).item.color, "charcoal");

  var got = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "GET", path: "/api/items/" + itemId } },
  });
  assert.equal(got.statusCode, 200);
  assert.equal(JSON.parse(got.body).item.color, "charcoal");

  var deleted = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "DELETE", path: "/api/items/" + itemId } },
  });
  assert.equal(deleted.statusCode, 204);

  var missing = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "GET", path: "/api/items/" + itemId } },
  });
  assert.equal(missing.statusCode, 404);
});

test("create rejects missing attributes", async function () {
  items.resetDepsForTests(makeMemoryDeps());
  var res = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify({ type: "shirt" }),
  });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /^missing_attribute:/);
});

test("update removes specific photos and deletes S3 objects", async function () {
  var memory = makeMemoryDeps();
  var deletedKeys = [];
  memory.s3.send = async function (command) {
    if (command.constructor.name === "DeleteObjectCommand") {
      deletedKeys.push(command.input.Key);
    }
    return {};
  };
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [{ contentType: "image/jpeg" }, { contentType: "image/png" }],
      })
    ),
  });
  assert.equal(created.statusCode, 201);
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoA = createdBody.uploads[0].photoId;
  var photoB = createdBody.uploads[1].photoId;

  await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoA, photoB] }),
  });

  var removed = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ removePhotoIds: [photoA] }),
  });
  assert.equal(removed.statusCode, 200);
  var removedBody = JSON.parse(removed.body);
  assert.equal(removedBody.item.photos.length, 1);
  assert.equal(removedBody.item.photos[0].photoId, photoB);
  assert.equal(deletedKeys.length, 1);
  assert.match(deletedKeys[0], new RegExp(photoA));

  var combined = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({
      removePhotoIds: [photoB],
      addPhotos: [{ contentType: "image/webp" }],
    }),
  });
  assert.equal(combined.statusCode, 200);
  var combinedBody = JSON.parse(combined.body);
  assert.equal(combinedBody.item.photos.length, 1);
  assert.equal(combinedBody.uploads.length, 1);
  assert.notEqual(combinedBody.item.photos[0].photoId, photoB);
  assert.ok(deletedKeys.some(function (key) {
    return key.indexOf(photoB) >= 0;
  }));
});
