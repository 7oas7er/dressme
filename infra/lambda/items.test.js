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
  var objects = new Map();
  return {
    store: store,
    objects: objects,
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
      send: async function (command) {
        var name = command.constructor.name;
        if (name === "PutObjectCommand") {
          objects.set(command.input.Key, Buffer.from(command.input.Body || []));
          return {};
        }
        if (name === "GetObjectCommand") {
          var body = objects.get(command.input.Key);
          if (!body) {
            var err = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            throw err;
          }
          return { Body: body };
        }
        if (name === "DeleteObjectCommand") {
          objects.delete(command.input.Key);
          return {};
        }
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
    makeThumb: async function (_buf) {
      return Buffer.from("thumb-bytes");
    },
    makeCutout: async function (_buf) {
      return Buffer.from("cutout-bytes");
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
  var photoKey = createdBody.uploads[0].uploadUrl.replace("https://upload.example/", "");
  memory.objects.set(photoKey, Buffer.from("full-res-jpeg"));

  var confirmed = await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoId] }),
  });
  assert.equal(confirmed.statusCode, 200);
  var confirmedBody = JSON.parse(confirmed.body);
  assert.equal(confirmedBody.item.photos[0].status, "ready");
  assert.ok(confirmedBody.item.photos[0].url);
  assert.ok(confirmedBody.item.photos[0].thumbUrl);
  assert.match(confirmedBody.item.photos[0].thumbUrl, /\.thumb\.jpg/);
  assert.ok(confirmedBody.item.photos[0].cutoutUrl);
  assert.match(confirmedBody.item.photos[0].cutoutUrl, /\.cutout\.webp/);
  assert.ok(memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".thumb.jpg"));
  assert.ok(memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".cutout.webp"));

  var listed = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "GET", path: "/api/items" } },
    queryStringParameters: { q: "navy" },
  });
  assert.equal(listed.statusCode, 200);
  var listBody = JSON.parse(listed.body);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].itemId, itemId);
  // List serves overview thumbs, not full-res urls.
  assert.equal(listBody.items[0].photos[0].url, undefined);
  assert.ok(listBody.items[0].photos[0].thumbUrl);
  assert.match(listBody.items[0].photos[0].thumbUrl, /\.thumb\.jpg/);

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
  var baseSend = memory.s3.send;
  memory.s3.send = async function (command) {
    if (command.constructor.name === "DeleteObjectCommand") {
      deletedKeys.push(command.input.Key);
    }
    return baseSend(command);
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
  for (var u = 0; u < createdBody.uploads.length; u++) {
    var key = createdBody.uploads[u].uploadUrl.replace("https://upload.example/", "");
    memory.objects.set(key, Buffer.from("full-" + u));
  }

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
  // Full + thumb + cutout deleted for removed photo.
  assert.ok(deletedKeys.filter(function (key) {
    return key.indexOf(photoA) >= 0;
  }).length >= 3);
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

test("backfill generates thumbs for ready photos missing thumbKey", async function () {
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
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoId = createdBody.uploads[0].photoId;
  var photoKey = createdBody.uploads[0].uploadUrl.replace("https://upload.example/", "");
  memory.objects.set(photoKey, Buffer.from("legacy-full"));

  // Simulate a pre-UC-20 ready photo (no thumbKey) by writing Dynamo directly.
  var itemKey = "USER#test-user|ITEM#" + itemId;
  var stored = memory.store.get(itemKey);
  stored.photos[0].status = "ready";
  delete stored.photos[0].thumbKey;
  memory.store.set(itemKey, stored);

  var backfill = await api.handler({
    rawPath: "/api/photos/backfill-thumbs",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-thumbs" },
    },
    body: JSON.stringify({}),
  });
  assert.equal(backfill.statusCode, 200);
  var body = JSON.parse(backfill.body);
  assert.equal(body.processed, 1);
  assert.equal(body.updatedItems, 1);
  assert.ok(memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".thumb.jpg"));

  var listed = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "GET", path: "/api/items" } },
  });
  var listBody = JSON.parse(listed.body);
  assert.match(listBody.items[0].photos[0].thumbUrl, /\.thumb\.jpg/);

  // Idempotent: second run skips.
  var again = await api.handler({
    rawPath: "/api/photos/backfill-thumbs",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-thumbs" },
    },
    body: JSON.stringify({}),
  });
  assert.equal(JSON.parse(again.body).processed, 0);
  assert.ok(photoId);
});

test("confirm and backfill generate cutouts for ready photos", async function () {
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
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoId = createdBody.uploads[0].photoId;
  var photoKey = createdBody.uploads[0].uploadUrl.replace("https://upload.example/", "");
  memory.objects.set(photoKey, Buffer.from("legacy-full-cutout"));

  // Simulate a pre-B2 ready photo (thumb present, no cutoutKey).
  var itemKey = "USER#test-user|ITEM#" + itemId;
  var stored = memory.store.get(itemKey);
  stored.photos[0].status = "ready";
  stored.photos[0].thumbKey = photoKey.replace(/\.[^.]+$/, "") + ".thumb.jpg";
  memory.objects.set(stored.photos[0].thumbKey, Buffer.from("thumb"));
  delete stored.photos[0].cutoutKey;
  memory.store.set(itemKey, stored);

  var backfill = await api.handler({
    rawPath: "/api/photos/backfill-cutouts",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-cutouts" },
    },
    body: JSON.stringify({}),
  });
  assert.equal(backfill.statusCode, 200);
  var body = JSON.parse(backfill.body);
  assert.equal(body.processed, 1);
  assert.equal(body.updatedItems, 1);
  assert.ok(memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".cutout.webp"));

  var listed = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "GET", path: "/api/items" } },
  });
  var listBody = JSON.parse(listed.body);
  assert.match(listBody.items[0].photos[0].cutoutUrl, /\.cutout\.webp/);

  var again = await api.handler({
    rawPath: "/api/photos/backfill-cutouts",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-cutouts" },
    },
    body: JSON.stringify({}),
  });
  var againBody = JSON.parse(again.body);
  assert.equal(againBody.processed, 0);
  assert.equal(againBody.cutoutVersion, require("./cutouts").CUTOUT_VERSION);
  assert.ok(photoId);

  // Force regenerates in place (same key) and counts as processed.
  var forced = await api.handler({
    rawPath: "/api/photos/backfill-cutouts",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-cutouts" },
    },
    body: JSON.stringify({ force: true }),
  });
  assert.equal(forced.statusCode, 200);
  assert.equal(JSON.parse(forced.body).processed, 1);
});

test("cutout failure does not block photos/complete", async function () {
  var memory = makeMemoryDeps();
  memory.makeCutout = async function () {
    throw new Error("matte_boom");
  };
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [{ contentType: "image/png" }],
      })
    ),
  });
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoId = createdBody.uploads[0].photoId;
  var photoKey = createdBody.uploads[0].uploadUrl.replace("https://upload.example/", "");
  memory.objects.set(photoKey, Buffer.from("full-png"));

  var confirmed = await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoId] }),
  });
  assert.equal(confirmed.statusCode, 200);
  var confirmedBody = JSON.parse(confirmed.body);
  assert.equal(confirmedBody.item.photos[0].status, "ready");
  assert.ok(confirmedBody.item.photos[0].thumbUrl);
  assert.equal(confirmedBody.item.photos[0].cutoutUrl, undefined);
});
