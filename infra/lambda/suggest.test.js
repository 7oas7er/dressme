"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";

var items = require("./items");
var api = require("./api");
var suggest = require("./suggest");

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
    makeThumb: async function () {
      return Buffer.from("thumb-bytes");
    },
  };
}

function seedItem(memory, attrs) {
  var itemId = attrs.itemId || "item-" + memory.store.size;
  var record = Object.assign(
    {
      pk: "USER#test-user",
      sk: "ITEM#" + itemId,
      itemId: itemId,
      userId: "test-user",
      photos: [
        {
          photoId: "photo-" + itemId,
          key: "users/test-user/items/" + itemId + "/p.jpg",
          contentType: "image/jpeg",
          status: "ready",
          thumbKey: "users/test-user/items/" + itemId + "/p.thumb.jpg",
          cutoutKey: "users/test-user/items/" + itemId + "/p.cutout.webp",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    attrs
  );
  memory.store.set(record.pk + "|" + record.sk, record);
  return record;
}

test("classifySlot maps outfitRole/type into menswear slots", function () {
  assert.equal(suggest.classifySlot({ outfitRole: "footwear", type: "boots" }), "footwear");
  assert.equal(suggest.classifySlot({ outfitRole: "trousers", type: "chinos" }), "trousers");
  assert.equal(suggest.classifySlot({ outfitRole: "shirt", type: "oxford" }), "base");
  assert.equal(suggest.classifySlot({ outfitRole: "outerwear", type: "blazer" }), "outer");
  assert.equal(suggest.classifySlot({ outfitRole: "mystery", type: "widget" }), null);
});

test("assembleRandomLooks returns exactly three looks and skips empty slots", function () {
  var catalog = [
    { itemId: "a", outfitRole: "footwear", type: "loafers" },
    { itemId: "b", outfitRole: "trousers", type: "chinos" },
    { itemId: "c", outfitRole: "shirt", type: "oxford" },
    { itemId: "d", outfitRole: "outerwear", type: "blazer" },
    { itemId: "e", outfitRole: "footwear", type: "boots" },
    { itemId: "f", outfitRole: "trousers", type: "jeans" },
    { itemId: "g", outfitRole: "base", type: "knit" },
  ];
  var seq = [0.1, 0.8, 0.3, 0.6, 0.2, 0.9, 0.4, 0.7, 0.15, 0.55];
  var i = 0;
  var looks = suggest.assembleRandomLooks(catalog, {
    random: function () {
      var v = seq[i % seq.length];
      i += 1;
      return v;
    },
  });
  assert.equal(looks.length, 3);
  for (var n = 0; n < looks.length; n++) {
    assert.ok(looks[n].items.length >= 1);
    // No belt/neckwear in catalog → those slots skipped (not invented).
    var roles = looks[n].items.map(function (item) {
      return item.outfitRole;
    });
    assert.ok(!roles.includes("belt"));
  }
  var allIds = looks.flatMap(function (look) {
    return look.items.map(function (item) {
      return item.itemId;
    });
  });
  assert.ok(new Set(allIds).size >= 4, "prefer variety across looks when catalog allows");
});

test("POST /api/suggest requires occasion and returns three enriched looks", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  seedItem(memory, {
    itemId: "shoes-1",
    type: "loafers",
    color: "brown",
    fabric: "leather",
    brandModel: "Alden",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "footwear",
  });
  seedItem(memory, {
    itemId: "pants-1",
    type: "chinos",
    color: "khaki",
    fabric: "cotton",
    brandModel: "Incotex",
    formality: "smart casual",
    pattern: "solid",
    season: "all-season",
    outfitRole: "trousers",
  });
  seedItem(memory, {
    itemId: "shirt-1",
    type: "oxford",
    color: "white",
    fabric: "cotton",
    brandModel: "Gitman",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "shirt",
  });

  var missing = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({ weather: "cool" }),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(JSON.parse(missing.body).error, "missing_occasion");

  var ok = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({
      occasion: "Tuesday client lunch",
      weather: "cool and dry",
    }),
  });
  assert.equal(ok.statusCode, 200);
  var body = JSON.parse(ok.body);
  assert.equal(body.engine, "random");
  assert.equal(body.occasion, "Tuesday client lunch");
  assert.equal(body.weather, "cool and dry");
  assert.equal(body.looks.length, 3);
  assert.ok(body.suggestionId);
  var first = body.looks[0];
  assert.ok(first.items.length >= 1);
  assert.ok(first.items[0].photos[0].url);
  assert.match(first.items[0].photos[0].url, /^https:\/\/read\.example\//);
});

test("Bedrock engine extension point returns 501 until wired", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedItem(memory, {
    itemId: "only",
    type: "shirt",
    color: "blue",
    fabric: "cotton",
    brandModel: "x",
    formality: "casual",
    pattern: "solid",
    season: "summer",
    outfitRole: "shirt",
  });

  var res = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({ occasion: "weekend", engine: "bedrock" }),
  });
  assert.equal(res.statusCode, 501);
  assert.equal(JSON.parse(res.body).error, "suggest_engine_unavailable");
});
