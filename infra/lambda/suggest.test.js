"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";
process.env.BEDROCK_MODEL_ID = "test-suggest-model";
process.env.SUGGEST_ENGINE = "random";

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

function seedClassicCatalog(memory) {
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
    aiContext: "Good for client lunches; pairs with navy.",
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
  seedItem(memory, {
    itemId: "blazer-1",
    type: "blazer",
    color: "navy",
    fabric: "wool",
    brandModel: "Ring Jacket",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
  });
}

function mockBedrockLooks(overrides) {
  var looks = [
    {
      lookId: "1",
      title: "Boardroom Navy",
      itemIds: ["shoes-1", "pants-1", "shirt-1", "blazer-1"],
      rationale: "Navy blazer and white oxford suit a boardroom lunch.",
    },
    {
      lookId: "2",
      title: "Soft Khaki Lunch",
      itemIds: ["shoes-1", "pants-1", "shirt-1"],
      rationale: "Drop the jacket for a softer smart-casual read.",
    },
    {
      lookId: "3",
      title: "Blazer Without Tie",
      itemIds: ["shoes-1", "pants-1", "shirt-1", "blazer-1"],
      rationale: "Same palette with loafers keeping the look grounded.",
    },
  ];
  if (overrides) {
    for (var i = 0; i < overrides.length; i++) {
      looks[i] = Object.assign({}, looks[i], overrides[i]);
    }
  }
  return {
    output: {
      message: {
        content: [{ text: JSON.stringify({ looks: looks }) }],
      },
    },
    usage: { inputTokens: 1200, outputTokens: 280 },
  };
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

test("resolveContext prefers context and shims occasion/weather", function () {
  assert.equal(
    suggest.resolveContext({ context: "opera tonight, rainy" }),
    "opera tonight, rainy"
  );
  assert.equal(
    suggest.resolveContext({
      occasion: "client lunch",
      weather: "cool and dry",
    }),
    "client lunch; cool and dry"
  );
  assert.equal(suggest.resolveContext({ occasion: "weekend" }), "weekend");
  assert.equal(suggest.resolveContext({ weather: "only weather" }), "");
  assert.equal(suggest.resolveContext({}), "");
  assert.ok(suggest.resolveContext({ context: "x".repeat(600) }).length <= 480);
});

test("serializeCatalogForPrompt omits photos/URLs and clamps aiContext", function () {
  var longCtx = "note ".repeat(100);
  var rows = suggest.serializeCatalogForPrompt([
    {
      itemId: "a1",
      type: "shirt",
      color: "white",
      fabric: "cotton",
      brandModel: "Gitman",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "shirt",
      aiContext: longCtx,
      photos: [
        {
          photoId: "p1",
          key: "users/u/items/a1/p.jpg",
          url: "https://evil.example/secret.jpg",
          thumbUrl: "https://evil.example/thumb.jpg",
        },
      ],
      pk: "USER#u",
      sk: "ITEM#a1",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a1");
  assert.equal(rows[0].type, "shirt");
  assert.ok(rows[0].aiContext.length <= 300);
  assert.equal(rows[0].photos, undefined);
  assert.equal(rows[0].url, undefined);
  assert.equal(rows[0].pk, undefined);
  assert.equal(rows[0].wada, undefined);
  assert.equal(rows[0].wadaId, undefined);
  var dumped = JSON.stringify(rows);
  assert.ok(!/https?:\/\//i.test(dumped));
  assert.ok(!/photos/i.test(dumped));
  assert.ok(!/base64/i.test(dumped));
});

test("serializeCatalogForPrompt includes primary Wada name and id", function () {
  var rows = suggest.serializeCatalogForPrompt([
    {
      itemId: "navy-suit",
      type: "suit jacket",
      color: "navy",
      fabric: "wool",
      brandModel: "",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "outer",
      wadaColorIds: ["wada:v1:42", "wada:v1:7"],
    },
    {
      itemId: "no-wada",
      type: "shirt",
      color: "white",
      fabric: "cotton",
      brandModel: "",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "shirt",
      wadaColorIds: [],
    },
    {
      itemId: "stale-wada",
      type: "trousers",
      color: "grey",
      fabric: "wool",
      brandModel: "",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "trousers",
      wadaColorIds: ["wada:v1:999"],
    },
  ]);
  assert.equal(rows[0].color, "navy");
  assert.equal(rows[0].wada, "Seashell Pink");
  assert.equal(rows[0].wadaId, "wada:v1:42");
  assert.equal(rows[0].wadaColorIds, undefined);
  assert.equal(rows[1].wada, undefined);
  assert.equal(rows[1].wadaId, undefined);
  assert.equal(rows[2].wada, undefined);
  assert.equal(rows[2].wadaId, undefined);
  var dumped = JSON.stringify(rows);
  assert.ok(!/wadaColorIds/i.test(dumped));
  assert.ok(!/combination/i.test(dumped));
});

test("systemPrompt mentions Wada true-color reference and mandatory core", function () {
  var prompt = suggest.systemPrompt();
  assert.match(prompt, /wada/i);
  assert.match(prompt, /true-color/i);
  assert.match(prompt, /Never invent item IDs/);
  assert.match(prompt, /mandatory core/i);
  assert.match(prompt, /Accessories are optional/i);
  assert.match(prompt, /title/);
});

test("assertLooksComplete accepts core-only and rejects competing bases", function () {
  var catalog = [
    { itemId: "s1", outfitRole: "footwear", type: "loafers" },
    { itemId: "p1", outfitRole: "trousers", type: "chinos" },
    { itemId: "b1", outfitRole: "shirt", type: "oxford" },
    { itemId: "b2", outfitRole: "base", type: "polo" },
    { itemId: "h1", outfitRole: "accessory", type: "hat" },
  ];
  var byId = new Map(catalog.map(function (row) {
    return [row.itemId, row];
  }));
  var ok = suggest.assertLooksComplete(
    [{ lookId: "1", itemIds: ["b1", "p1", "s1"] }],
    byId,
    catalog
  );
  assert.equal(ok.incomplete.length, 0);
  var withHat = suggest.assertLooksComplete(
    [{ lookId: "1", itemIds: ["b1", "p1", "s1"] }],
    byId,
    catalog
  );
  assert.equal(withHat.incomplete.length, 0);
  var noHatStillOk = suggest.assertLooksComplete(
    [{ lookId: "1", itemIds: ["b1", "p1", "s1", "h1"] }],
    byId,
    catalog
  );
  assert.equal(noHatStillOk.incomplete.length, 0);
  var competing = suggest.assertLooksComplete(
    [{ lookId: "2", itemIds: ["b1", "b2", "p1", "s1"] }],
    byId,
    catalog
  );
  assert.equal(competing.incomplete.length, 1);
  assert.ok(competing.incomplete[0].reasons.includes("competing_bases"));
  var missingBottom = suggest.assertLooksComplete(
    [{ lookId: "3", itemIds: ["b1", "s1"] }],
    byId,
    catalog
  );
  assert.ok(missingBottom.incomplete[0].reasons.includes("missing_trousers"));
  var missingShoes = suggest.assertLooksComplete(
    [{ lookId: "4", itemIds: ["b1", "p1"] }],
    byId,
    catalog
  );
  assert.ok(missingShoes.incomplete[0].reasons.includes("missing_footwear"));
  var noShoesInCloset = [
    { itemId: "p1", outfitRole: "trousers", type: "chinos" },
    { itemId: "b1", outfitRole: "shirt", type: "oxford" },
  ];
  var byIdNoShoes = new Map(noShoesInCloset.map(function (row) {
    return [row.itemId, row];
  }));
  var okWithoutShoes = suggest.assertLooksComplete(
    [{ lookId: "1", itemIds: ["b1", "p1"] }],
    byIdNoShoes,
    noShoesInCloset
  );
  assert.equal(okWithoutShoes.incomplete.length, 0);
});

test("clampTitle strips quotes and clamps length", function () {
  assert.equal(suggest.clampTitle('  "Soft Navy Stack"  '), "Soft Navy Stack");
  assert.equal(suggest.clampTitle("x".repeat(80)).length, 48);
  assert.equal(suggest.clampTitle(""), "");
});

test("validateLookPayload drops unknown IDs and tracks empty looks", function () {
  var allowed = new Set(["a", "b", "c"]);
  var result = suggest.validateLookPayload(
    {
      looks: [
        { lookId: "1", itemIds: ["a", "ghost", "b"], rationale: "ok" },
        { lookId: "2", itemIds: ["nope"], rationale: "bad" },
        { lookId: "3", itemIds: ["c"], rationale: "solo" },
      ],
    },
    allowed
  );
  assert.deepEqual(result.looks[0].itemIds, ["a", "b"]);
  assert.deepEqual(result.looks[1].itemIds, []);
  assert.deepEqual(result.looks[2].itemIds, ["c"]);
  assert.equal(result.emptyLookCount, 1);
  assert.ok(result.looks[0].rationale.length <= 400);
});

test("parseJsonObject strips markdown fences", function () {
  var parsed = suggest.parseJsonObject(
    "```json\n{\"looks\":[{\"lookId\":\"1\",\"itemIds\":[\"a\"],\"rationale\":\"x\"}]}\n```"
  );
  assert.equal(parsed.looks[0].itemIds[0], "a");
});

test("POST /api/suggest requires context and returns three enriched looks", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var missing = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({ weather: "cool" }),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(JSON.parse(missing.body).error, "missing_context");

  var ok = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({
      context: "Tuesday client lunch, cool and dry",
    }),
  });
  assert.equal(ok.statusCode, 200);
  var body = JSON.parse(ok.body);
  assert.equal(body.engine, "random");
  assert.equal(body.context, "Tuesday client lunch, cool and dry");
  assert.equal(body.occasion, undefined);
  assert.equal(body.weather, undefined);
  assert.equal(body.looks.length, 3);
  assert.ok(body.suggestionId);
  var first = body.looks[0];
  assert.ok(first.items.length >= 1);
  assert.ok(first.items[0].photos[0].url);
  assert.match(first.items[0].photos[0].url, /^https:\/\/read\.example\//);
});

test("legacy occasion/weather shim still works for random engine", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

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
  assert.equal(body.context, "Tuesday client lunch; cool and dry");
  assert.equal(body.looks.length, 3);
});

test("Bedrock engine returns three looks with rationale and logs tokens", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var calls = [];
  suggest.resetDepsForTests({
    converse: async function (input) {
      calls.push(input);
      assert.equal(input.modelId, "test-suggest-model");
      assert.equal(input.inferenceConfig.temperature, 0.3);
      var userText = input.messages[0].content[0].text;
      assert.match(userText, /Catalog JSON:/);
      assert.ok(!/https?:\/\//i.test(userText));
      assert.ok(!/"photos"/i.test(userText));
      return mockBedrockLooks();
    },
  });

  var logs = [];
  var originalLog = console.log;
  console.log = function () {
    logs.push(Array.prototype.slice.call(arguments).join(" "));
  };

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({
        context: "board meeting tomorrow morning, cool and dry",
        engine: "bedrock",
      }),
    });
  } finally {
    console.log = originalLog;
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.engine, "bedrock");
  assert.equal(body.modelId, "test-suggest-model");
  assert.equal(body.context, "board meeting tomorrow morning, cool and dry");
  assert.equal(body.looks.length, 3);
  assert.match(body.looks[0].rationale, /Navy blazer/);
  assert.equal(body.looks[0].title, "Boardroom Navy");
  assert.ok(body.looks[0].items.length >= 1);
  assert.ok(body.looks[0].items[0].photos[0].thumbUrl || body.looks[0].items[0].photos[0].url);
  assert.equal(calls.length, 1);

  var successLine = logs.find(function (line) {
    return line.indexOf("suggest_success") >= 0;
  });
  assert.ok(successLine);
  var parsedLog = JSON.parse(successLine);
  assert.equal(parsedLog.event, "suggest_success");
  assert.equal(parsedLog.modelId, "test-suggest-model");
  assert.equal(parsedLog.inputTokens, 1200);
  assert.equal(parsedLog.outputTokens, 280);
  assert.equal(parsedLog.lookCount, 3);
  assert.ok(parsedLog.suggestionId);
  assert.equal(parsedLog.context, undefined);
});

test("Bedrock drops hallucinated IDs and repairs empty looks", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var call = 0;
  suggest.resetDepsForTests({
    converse: async function () {
      call += 1;
      if (call === 1) {
        return {
          output: {
            message: {
              content: [
                {
                  text: JSON.stringify({
                    looks: [
                      {
                        lookId: "1",
                        itemIds: ["shoes-1", "not-real"],
                        rationale: "first",
                      },
                      { lookId: "2", itemIds: ["invented"], rationale: "empty" },
                      {
                        lookId: "3",
                        itemIds: ["shirt-1", "pants-1"],
                        rationale: "third",
                      },
                    ],
                  }),
                },
              ],
            },
          },
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      }
      return mockBedrockLooks();
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({ context: "weekend market", engine: "bedrock" }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  assert.equal(call, 2);
  var body = JSON.parse(res.body);
  assert.equal(body.looks.length, 3);
  for (var i = 0; i < body.looks.length; i++) {
    assert.ok(body.looks[i].items.length >= 1);
    for (var j = 0; j < body.looks[i].items.length; j++) {
      assert.ok(
        ["shoes-1", "pants-1", "shirt-1", "blazer-1"].includes(
          body.looks[i].items[j].itemId
        )
      );
    }
  }
});

test("Bedrock failure returns suggest_unavailable without random fallback", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  suggest.resetDepsForTests({
    converse: async function () {
      var err = new Error("boom");
      err.name = "AccessDeniedException";
      throw err;
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({ context: "opera", engine: "bedrock" }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "suggest_unavailable");
});

test("Bedrock empty catalog skips model and returns empty looks", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  suggest.resetDepsForTests({
    converse: async function () {
      throw new Error("should not call bedrock");
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({ context: "anything", engine: "bedrock" }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.engine, "bedrock");
  assert.equal(body.looks.length, 3);
  assert.equal(body.looks[0].items.length, 0);
  assert.equal(body.modelId, undefined);
});

test("Bedrock incomplete looks repair then hard-fail", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var call = 0;
  suggest.resetDepsForTests({
    converse: async function () {
      call += 1;
      // Always missing trousers → completeness repair + still incomplete → 502.
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  looks: [
                    {
                      lookId: "1",
                      title: "Two Shirts",
                      itemIds: ["shirt-1", "blazer-1", "shoes-1"],
                      rationale: "no pants",
                    },
                    {
                      lookId: "2",
                      title: "Still No Pants",
                      itemIds: ["shirt-1", "shoes-1"],
                      rationale: "no pants",
                    },
                    {
                      lookId: "3",
                      title: "Jacket Only",
                      itemIds: ["blazer-1", "shoes-1"],
                      rationale: "no pants",
                    },
                  ],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 11, outputTokens: 11 },
      };
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({ context: "weekend", engine: "bedrock" }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, "suggest_incomplete_looks");
  assert.equal(call, 2);
});
