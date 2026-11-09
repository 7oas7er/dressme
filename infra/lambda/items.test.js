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
  assert.deepEqual(createdBody.item.wadaColorIds, []);
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
  // Cutout generation stopped (Option D) — thumbs still required.
  assert.equal(confirmedBody.item.photos[0].cutoutUrl, undefined);
  assert.ok(memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".thumb.jpg"));
  assert.equal(
    memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".cutout.webp"),
    false
  );
  assert.equal(items.CUTOUTS_ENABLED, false);

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
  // Full + thumb deleted for removed photo (cutout only if an old key existed).
  assert.ok(deletedKeys.filter(function (key) {
    return key.indexOf(photoA) >= 0;
  }).length >= 2);
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

test("replacePhotos rewrites same photoId in place and returns overwrite upload", async function () {
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
        photos: [
          { contentType: "image/jpeg" },
          { contentType: "image/png" },
          { contentType: "image/jpeg" },
        ],
      })
    ),
  });
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoA = createdBody.uploads[0].photoId;
  var photoB = createdBody.uploads[1].photoId;
  var photoC = createdBody.uploads[2].photoId;
  var photoBKey = createdBody.uploads[1].uploadUrl.replace(
    "https://upload.example/",
    ""
  );
  for (var u = 0; u < createdBody.uploads.length; u++) {
    var key = createdBody.uploads[u].uploadUrl.replace("https://upload.example/", "");
    memory.objects.set(key, Buffer.from("full-" + u));
  }
  await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoA, photoB, photoC] }),
  });

  var replaced = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({
      replacePhotos: [{ photoId: photoB, contentType: "image/jpeg" }],
    }),
  });
  assert.equal(replaced.statusCode, 200);
  var body = JSON.parse(replaced.body);
  assert.equal(body.item.photos.length, 3);
  assert.equal(body.item.photos[0].photoId, photoA);
  assert.equal(body.item.photos[1].photoId, photoB);
  assert.equal(body.item.photos[2].photoId, photoC);
  assert.equal(body.item.photos[1].status, "pending");
  assert.equal(body.item.photos[1].contentType, "image/jpeg");
  assert.equal(body.uploads.length, 1);
  assert.equal(body.uploads[0].photoId, photoB);
  assert.match(body.uploads[0].uploadUrl, new RegExp(photoB + "\\.jpg"));
  // Old png key + thumb cleared so complete can regen.
  assert.ok(deletedKeys.some(function (k) {
    return k === photoBKey || k.indexOf(photoB) >= 0;
  }));

  var itemKey = "USER#test-user|ITEM#" + itemId;
  var stored = memory.store.get(itemKey);
  assert.equal(stored.photos[1].photoId, photoB);
  assert.equal(stored.photos[1].thumbKey, undefined);
  assert.equal(stored.photos[1].status, "pending");
});

test("primaryPhotoId moves chosen photo to index 0 and is idempotent when already first", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [
          { contentType: "image/jpeg" },
          { contentType: "image/jpeg" },
          { contentType: "image/jpeg" },
        ],
      })
    ),
  });
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoA = createdBody.uploads[0].photoId;
  var photoB = createdBody.uploads[1].photoId;
  var photoC = createdBody.uploads[2].photoId;
  for (var u = 0; u < createdBody.uploads.length; u++) {
    var key = createdBody.uploads[u].uploadUrl.replace("https://upload.example/", "");
    memory.objects.set(key, Buffer.from("full-" + u));
  }
  await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoA, photoB, photoC] }),
  });

  var promoted = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ primaryPhotoId: photoB }),
  });
  assert.equal(promoted.statusCode, 200);
  var promotedBody = JSON.parse(promoted.body);
  assert.equal(promotedBody.item.photos.length, 3);
  assert.equal(promotedBody.item.photos[0].photoId, photoB);
  assert.equal(promotedBody.item.photos[1].photoId, photoA);
  assert.equal(promotedBody.item.photos[2].photoId, photoC);

  var again = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ primaryPhotoId: photoB }),
  });
  assert.equal(again.statusCode, 200);
  var againBody = JSON.parse(again.body);
  assert.equal(againBody.item.photos[0].photoId, photoB);
  assert.equal(againBody.item.photos[1].photoId, photoA);
  assert.equal(againBody.item.photos[2].photoId, photoC);

  var missing = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ primaryPhotoId: "no-such-photo" }),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(JSON.parse(missing.body).error, "photo_not_found");
});

test("addPhotos appends without stealing primary; primaryPhotoId after add promotes new photo", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [
          { contentType: "image/jpeg" },
          { contentType: "image/jpeg" },
        ],
      })
    ),
  });
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

  var added = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({
      addPhotos: [{ contentType: "image/jpeg" }],
    }),
  });
  assert.equal(added.statusCode, 200);
  var addedBody = JSON.parse(added.body);
  assert.equal(addedBody.item.photos.length, 3);
  assert.equal(addedBody.item.photos[0].photoId, photoA);
  assert.equal(addedBody.item.photos[1].photoId, photoB);
  var photoC = addedBody.uploads[0].photoId;
  assert.equal(addedBody.item.photos[2].photoId, photoC);

  var promoteNew = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({
      addPhotos: [{ contentType: "image/png" }],
      primaryPhotoId: photoC,
    }),
  });
  assert.equal(promoteNew.statusCode, 200);
  var promoteBody = JSON.parse(promoteNew.body);
  assert.equal(promoteBody.item.photos[0].photoId, photoC);
  assert.equal(promoteBody.item.photos[1].photoId, photoA);
  assert.equal(promoteBody.item.photos[2].photoId, photoB);
  assert.equal(promoteBody.item.photos.length, 4);
  assert.equal(promoteBody.uploads.length, 1);
  assert.notEqual(promoteBody.item.photos[3].photoId, photoC);
});

test("remove+add keeps replacement photos in the removed slots", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        photos: [
          { contentType: "image/jpeg" },
          { contentType: "image/jpeg" },
          { contentType: "image/jpeg" },
        ],
      })
    ),
  });
  var createdBody = JSON.parse(created.body);
  var itemId = createdBody.item.itemId;
  var photoA = createdBody.uploads[0].photoId;
  var photoB = createdBody.uploads[1].photoId;
  var photoC = createdBody.uploads[2].photoId;
  for (var u = 0; u < createdBody.uploads.length; u++) {
    var key = createdBody.uploads[u].uploadUrl.replace("https://upload.example/", "");
    memory.objects.set(key, Buffer.from("full-" + u));
  }
  await api.handler({
    rawPath: "/api/items/" + itemId + "/photos/complete",
    requestContext: {
      http: { method: "POST", path: "/api/items/" + itemId + "/photos/complete" },
    },
    body: JSON.stringify({ photoIds: [photoA, photoB, photoC] }),
  });

  // UC-18 rotate: replace middle photo — must stay at index 1, not append.
  var replaced = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({
      removePhotoIds: [photoB],
      addPhotos: [{ contentType: "image/jpeg" }],
    }),
  });
  assert.equal(replaced.statusCode, 200);
  var body = JSON.parse(replaced.body);
  assert.equal(body.item.photos.length, 3);
  assert.equal(body.item.photos[0].photoId, photoA);
  assert.equal(body.item.photos[2].photoId, photoC);
  assert.notEqual(body.item.photos[1].photoId, photoB);
  assert.equal(body.item.photos[1].photoId, body.uploads[0].photoId);
  assert.equal(body.item.photos[1].status, "pending");
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

test("cutout backfill noops while CUTOUTS_ENABLED=false", async function () {
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

  // Simulate a ready photo with thumb but no cutout (legacy).
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
  assert.equal(body.processed, 0);
  assert.equal(body.disabled, true);
  assert.equal(
    memory.objects.has(photoKey.replace(/\.[^.]+$/, "") + ".cutout.webp"),
    false
  );
  assert.ok(photoId);

  var forced = await api.handler({
    rawPath: "/api/photos/backfill-cutouts",
    requestContext: {
      http: { method: "POST", path: "/api/photos/backfill-cutouts" },
    },
    body: JSON.stringify({ force: true }),
  });
  assert.equal(forced.statusCode, 200);
  assert.equal(JSON.parse(forced.body).processed, 0);
  assert.equal(JSON.parse(forced.body).disabled, true);
});

test("legacy rotate route is gone (404 not_found)", async function () {
  items.resetDepsForTests(makeMemoryDeps());
  var rotateGet = await api.handler({
    rawPath: "/api/items/any-item/photos/any-photo/rotate",
    requestContext: {
      http: {
        method: "GET",
        path: "/api/items/any-item/photos/any-photo/rotate",
      },
    },
  });
  assert.equal(rotateGet.statusCode, 404);
  assert.equal(JSON.parse(rotateGet.body).error, "not_found");

  var rotatePost = await api.handler({
    rawPath: "/api/items/any-item/photos/any-photo/rotate",
    requestContext: {
      http: {
        method: "POST",
        path: "/api/items/any-item/photos/any-photo/rotate",
      },
    },
    body: JSON.stringify({ degrees: 90 }),
  });
  assert.equal(rotatePost.statusCode, 404);
  assert.equal(JSON.parse(rotatePost.body).error, "not_found");
});

test("photos/complete still succeeds without cutouts", async function () {
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

test("wadaColorIds create/update validate and always return array", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        wadaColorIds: ["wada:v1:42", "wada:v1:7", "wada:v1:42"],
      })
    ),
  });
  assert.equal(created.statusCode, 201);
  var createdBody = JSON.parse(created.body);
  assert.deepEqual(createdBody.item.wadaColorIds, ["wada:v1:42", "wada:v1:7"]);

  var itemId = createdBody.item.itemId;
  var cleared = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ wadaColorIds: [] }),
  });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(JSON.parse(cleared.body).item.wadaColorIds, []);

  var restored = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ wadaColorIds: ["wada:v1:0"] }),
  });
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(JSON.parse(restored.body).item.wadaColorIds, ["wada:v1:0"]);

  // Omitted on update leaves existing Wada refs.
  var colorOnly = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ color: "charcoal" }),
  });
  assert.equal(colorOnly.statusCode, 200);
  var colorBody = JSON.parse(colorOnly.body).item;
  assert.equal(colorBody.color, "charcoal");
  assert.deepEqual(colorBody.wadaColorIds, ["wada:v1:0"]);
});

test("wadaColorIds reject unknown ids and over-long lists", async function () {
  items.resetDepsForTests(makeMemoryDeps());

  var bad = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), { wadaColorIds: ["wada:v1:999"] })
    ),
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error, "invalid_wada_color");

  var tooMany = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(
      Object.assign(attrs(), {
        wadaColorIds: [
          "wada:v1:0",
          "wada:v1:1",
          "wada:v1:2",
          "wada:v1:3",
          "wada:v1:4",
        ],
      })
    ),
  });
  assert.equal(tooMany.statusCode, 400);
  assert.equal(JSON.parse(tooMany.body).error, "too_many_wada_colors");
});
