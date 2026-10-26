"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";

var attributeOptions = require("./attributeOptions");
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

function attrs(overrides) {
  return Object.assign(
    {
      type: "jacket",
      color: "navy",
      fabric: "wool",
      brandModel: "Example Co. Blazer",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "outerwear",
    },
    overrides || {}
  );
}

test("attribute options returns classic menswear seeds", async function () {
  items.resetDepsForTests(makeMemoryDeps());
  var res = await api.handler({
    rawPath: "/api/attribute-options",
    requestContext: { http: { method: "GET", path: "/api/attribute-options" } },
  });
  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.ok(body.fields.includes("fabric"));
  assert.ok(body.options.type.includes("blazer"));
  assert.ok(body.options.fabric.includes("tweed"));
  assert.ok(body.options.formality.includes("smart casual"));
  assert.deepEqual(body.custom.fabric, []);
});

test("create/update remembers free-text values for later dropdowns", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);

  var created = await api.handler({
    rawPath: "/api/items",
    requestContext: { http: { method: "POST", path: "/api/items" } },
    body: JSON.stringify(attrs({ fabric: "vintage hopsack", color: "petrol" })),
  });
  assert.equal(created.statusCode, 201);

  var options = await api.handler({
    rawPath: "/api/attribute-options",
    requestContext: { http: { method: "GET", path: "/api/attribute-options" } },
  });
  assert.equal(options.statusCode, 200);
  var body = JSON.parse(options.body);
  assert.ok(body.options.fabric.includes("vintage hopsack"));
  assert.ok(body.options.color.includes("petrol"));
  assert.ok(body.custom.fabric.includes("vintage hopsack"));
  // Seed values are not stored as custom.
  assert.ok(!body.custom.type.includes("jacket"));

  var itemId = JSON.parse(created.body).item.itemId;
  var updated = await api.handler({
    rawPath: "/api/items/" + itemId,
    requestContext: { http: { method: "PUT", path: "/api/items/" + itemId } },
    body: JSON.stringify({ outfitRole: "statement layer" }),
  });
  assert.equal(updated.statusCode, 200);

  var again = await api.handler({
    rawPath: "/api/attribute-options",
    requestContext: { http: { method: "GET", path: "/api/attribute-options" } },
  });
  var againBody = JSON.parse(again.body);
  assert.ok(againBody.options.outfitRole.includes("statement layer"));
  // Prior customs still present.
  assert.ok(againBody.options.fabric.includes("vintage hopsack"));
});

test("seed match is case-insensitive and does not duplicate customs", async function () {
  items.resetDepsForTests(makeMemoryDeps());
  var user = { sub: "local-dev-user" };
  await attributeOptions.rememberCustomValues(user, { fabric: "Wool" });
  await attributeOptions.rememberCustomValues(user, { fabric: "my custom weave" });
  await attributeOptions.rememberCustomValues(user, { fabric: "My Custom Weave" });
  var listed = await attributeOptions.listAttributeOptions(user);
  assert.equal(listed.body.custom.fabric.length, 1);
  assert.equal(listed.body.custom.fabric[0], "my custom weave");
  assert.ok(listed.body.options.fabric.includes("wool"));
  assert.ok(listed.body.options.fabric.includes("my custom weave"));
});
