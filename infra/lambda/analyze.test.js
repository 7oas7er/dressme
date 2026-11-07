"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";
process.env.BEDROCK_MODEL_ID = "test-model";

var items = require("./items");
var analyze = require("./analyze");
var api = require("./api");

function tinyJpegBase64() {
  // 1x1 JPEG
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z",
    "base64"
  ).toString("base64");
}

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
        return { Body: Buffer.from("fake-image") };
      },
    },
    sign: async function (_client, command) {
      return "https://example/" + command.input.Key;
    },
    makeThumb: async function () {
      return Buffer.from("thumb");
    },
  };
}

test("parseJsonObject extracts fenced JSON", function () {
  var parsed = analyze.parseJsonObject(
    'Here:\n```json\n{"label":"shirt","attributes":{"type":"shirt"}}\n```'
  );
  assert.equal(parsed.label, "shirt");
  assert.equal(parsed.attributes.type, "shirt");
});

test("normalizeProposal fills attr keys", function () {
  var proposal = analyze.normalizeProposal({
    label: "navy blazer",
    attributes: { type: "blazer", color: "navy" },
    aiContext: "Office jacket",
    followUpQuestions: ["Lined?", ""],
    notes: "Brand unclear",
  });
  assert.equal(proposal.label, "navy blazer");
  assert.equal(proposal.attributes.type, "blazer");
  assert.equal(proposal.attributes.fabric, "");
  assert.equal(proposal.aiContext, "Office jacket");
  assert.deepEqual(proposal.followUpQuestions, ["Lined?"]);
});

test("analyzeItem with mocked Bedrock returns proposal", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  analyze.resetDepsForTests({
    converse: async function () {
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  label: "dress shirt",
                  attributes: {
                    type: "dress shirt",
                    color: "white",
                    fabric: "cotton",
                    brandModel: "",
                    formality: "business",
                    pattern: "solid",
                    season: "all-season",
                    outfitRole: "base",
                  },
                  aiContext: "White dress shirt for meetings.",
                  followUpQuestions: ["French cuffs?"],
                  notes: "",
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 120, outputTokens: 80 },
      };
    },
  });

  var logged = [];
  var originalLog = console.log;
  console.log = function () {
    logged.push(Array.prototype.slice.call(arguments).join(" "));
  };
  var result;
  try {
    result = await analyze.analyzeItem(
      { sub: "test-user" },
      {
        imageBase64: tinyJpegBase64(),
        contentType: "image/jpeg",
        answers: "board meetings",
      }
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.proposal.label, "dress shirt");
  assert.equal(result.body.proposal.attributes.outfitRole, "base");
  assert.equal(result.body.source, "upload");
  assert.equal(result.body.modelId, "test-model");
  assert.equal(logged.length, 1);
  var line = JSON.parse(logged[0]);
  assert.equal(line.event, "analyze_success");
  assert.equal(line.modelId, "test-model");
  assert.equal(line.inputTokens, 120);
  assert.equal(line.outputTokens, 80);
  assert.equal(Object.prototype.hasOwnProperty.call(line, "aiContext"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(line, "prompt"), false);
});

test("POST /api/items/analyze is routed", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  analyze.resetDepsForTests({
    converse: async function () {
      return {
        output: {
          message: {
            content: [
              {
                text: '{"label":"tie","attributes":{"type":"tie","color":"navy","fabric":"silk","brandModel":"","formality":"business","pattern":"solid","season":"all-season","outfitRole":"neckwear"},"aiContext":"Navy silk tie.","followUpQuestions":[]}',
              },
            ],
          },
        },
      };
    },
  });

  var res = await api.handler({
    rawPath: "/api/items/analyze",
    requestContext: { http: { method: "POST", path: "/api/items/analyze" } },
    headers: {},
    body: JSON.stringify({
      imageBase64: tinyJpegBase64(),
      contentType: "image/jpeg",
    }),
  });
  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.proposal.attributes.type, "tie");
});

test("createItem persists aiContext", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  var created = await items.createItem(
    { sub: "test-user" },
    {
      type: "shirt",
      color: "white",
      fabric: "cotton",
      brandModel: "n/a",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "base",
      aiContext: "Boardroom shirt",
      photos: [],
    }
  );
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.item.aiContext, "Boardroom shirt");

  var got = await items.getItem({ sub: "test-user" }, created.body.item.itemId);
  assert.equal(got.body.item.aiContext, "Boardroom shirt");
});

test("analyze rejects missing image and item", async function () {
  await assert.rejects(
    () => analyze.analyzeItem({ sub: "u" }, {}),
    (err) => err.statusCode === 400 && err.message === "image_or_item_required"
  );
});

test("analyze maps Bedrock AccessDenied to analyze_unavailable", async function () {
  analyze.resetDepsForTests({
    converse: async function () {
      var err = new Error("not authorized");
      err.name = "AccessDeniedException";
      throw err;
    },
  });
  await assert.rejects(
    () =>
      analyze.analyzeItem(
        { sub: "u" },
        { imageBase64: tinyJpegBase64(), contentType: "image/jpeg" }
      ),
    (err) => err.statusCode === 503 && err.message === "analyze_unavailable"
  );
});
