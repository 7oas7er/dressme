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
    fabric: "wool",
    brandModel: "Ring Jacket",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
  });
}

function mockBedrockLooks(overrides, lookCount) {
  var count = lookCount != null ? lookCount : 3;
  var templates = [
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
  var looks = [];
  for (var i = 0; i < count; i++) {
    var base = templates[i % templates.length];
    looks.push(
      Object.assign({}, base, {
        lookId: String(i + 1),
        title: base.title + (i >= templates.length ? " " + (i + 1) : ""),
      })
    );
  }
  if (overrides) {
    for (var j = 0; j < overrides.length; j++) {
      looks[j] = Object.assign({}, looks[j], overrides[j]);
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
  // Multi-token / layer roles must not become a second "base".
  assert.equal(
    suggest.classifySlot({ outfitRole: "layer, knitwear", type: "cardigan" }),
    "outer"
  );
  assert.equal(
    suggest.classifySlot({ outfitRole: "overshirt", type: "overshirt" }),
    "outer"
  );
  assert.equal(
    suggest.classifySlot({ outfitRole: "knitwear", type: "cardigan" }),
    "base"
  );
});

test("salvageCompetingBases keeps the first base only", function () {
  var catalog = [
    { itemId: "shirt1", outfitRole: "shirt", type: "oxford" },
    { itemId: "knit1", outfitRole: "knitwear", type: "sweater" },
    { itemId: "pants1", outfitRole: "trousers", type: "chinos" },
    { itemId: "shoe1", outfitRole: "footwear", type: "loafers" },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var salvaged = suggest.salvageCompetingBases(
    [{ lookId: "1", itemIds: ["shirt1", "knit1", "pants1", "shoe1"] }],
    byId
  );
  assert.deepEqual(salvaged[0].itemIds, ["shirt1", "pants1", "shoe1"]);
  var ok = suggest.assertLooksComplete(salvaged, byId, catalog);
  assert.equal(ok.incomplete.length, 0);
});

test("enforceSlotUniqueness drops dual footwear and extra outers", function () {
  var catalog = [
    { itemId: "shirt1", outfitRole: "shirt", type: "oxford", formality: "business" },
    { itemId: "pants1", outfitRole: "trousers", type: "chinos", formality: "business" },
    {
      itemId: "loafer1",
      outfitRole: "footwear",
      type: "loafers",
      formality: "business",
    },
    {
      itemId: "boot1",
      outfitRole: "footwear",
      type: "boots",
      formality: "casual",
    },
    {
      itemId: "jacket1",
      outfitRole: "outerwear",
      type: "leather jacket",
      formality: "smart casual",
    },
    {
      itemId: "cardigan1",
      outfitRole: "outerwear",
      type: "cardigan",
      formality: "casual",
    },
    { itemId: "belt1", outfitRole: "belt", type: "leather belt" },
    { itemId: "belt2", outfitRole: "belt", type: "fabric belt" },
    { itemId: "hat1", outfitRole: "accessory", type: "hat" },
    { itemId: "scarf1", outfitRole: "accessory", type: "scarf" },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var salvaged = suggest.enforceSlotUniqueness(
    [
      {
        lookId: "2",
        itemIds: [
          "shirt1",
          "pants1",
          "loafer1",
          "boot1",
          "jacket1",
          "cardigan1",
          "belt1",
          "belt2",
          "hat1",
          "scarf1",
        ],
      },
    ],
    byId
  );
  assert.deepEqual(salvaged[0].itemIds, [
    "shirt1",
    "pants1",
    "loafer1",
    "jacket1",
    "belt1",
    "hat1",
    "scarf1",
  ]);
  var check = suggest.lookCompleteness(salvaged[0].itemIds, byId, {
    requireFootwear: true,
  });
  assert.equal(check.ok, true);
  assert.ok(!check.reasons.includes("duplicate_footwear"));
});

test("syncLookCopy rewrites title/rationale after ID change or foreign copy", function () {
  var catalog = [
    {
      itemId: "shirt1",
      outfitRole: "shirt",
      type: "oxford",
      brandModel: "TM Lewin",
      fabric: "cotton",
      wadaColorIds: ["wada:v1:42"],
    },
    {
      itemId: "pants1",
      outfitRole: "trousers",
      type: "chinos",
      fabric: "cotton twill",
      wadaColorIds: ["wada:v1:7"],
    },
    { itemId: "shoe1", outfitRole: "footwear", type: "loafers" },
    {
      itemId: "jacket1",
      outfitRole: "outerwear",
      type: "leather jacket",
      brandModel: "Schott",
      fabric: "leather",
    },
    {
      itemId: "cardigan1",
      outfitRole: "outerwear",
      type: "cardigan",
      brandModel: "John Smedley",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var ctx = "cool garden evening, 4 looks";
  var afterDrop = suggest.syncLookCopy(
    {
      lookId: "1",
      title: "Soft Cardigan Evening",
      rationale: "A cardigan softens the leather jacket stack for the garden.",
      itemIds: ["shirt1", "pants1", "shoe1", "jacket1"],
    },
    ["shirt1", "pants1", "shoe1", "jacket1", "cardigan1"],
    byId,
    catalog,
    ctx
  );
  assert.ok(!/cardigan/i.test(afterDrop.title));
  assert.ok(!/cardigan/i.test(afterDrop.rationale));
  // Occasion-led titles (not Wada/brand dumps); jacket remains in the look copy.
  assert.match(afterDrop.title, /garden|jacket|layered/i);
  assert.match(afterDrop.rationale, /leather jacket|Schott|jacket/i);
  assert.ok(!/cardigan/i.test(afterDrop.rationale));
  // Verbose advice tone — not a one-line "Pairs A with B" stub.
  var sentences = afterDrop.rationale
    .split(/(?<=\.)\s+/)
    .filter(Boolean);
  assert.ok(sentences.length >= 2, afterDrop.rationale);
  assert.match(afterDrop.rationale, /garden|chill|cool|layer|For /i);
  assert.ok(afterDrop.rationale.length > 80);

  var foreignOnly = suggest.syncLookCopy(
    {
      lookId: "1",
      title: "Cardigan Cool",
      rationale: "The cardigan keeps the chill off.",
      itemIds: ["shirt1", "pants1", "shoe1", "jacket1"],
    },
    ["shirt1", "pants1", "shoe1", "jacket1"],
    byId,
    catalog,
    ctx
  );
  assert.ok(!/cardigan/i.test(foreignOnly.title));
  assert.ok(!/cardigan/i.test(foreignOnly.rationale));
  assert.ok(foreignOnly.rationale.split(/(?<=\.)\s+/).filter(Boolean).length >= 2);

  var unchanged = suggest.syncLookCopy(
    {
      lookId: "1",
      title: "Schott Leather Night",
      rationale: "Schott leather jacket over oxford and chinos.",
      itemIds: ["shirt1", "pants1", "shoe1", "jacket1"],
    },
    ["shirt1", "pants1", "shoe1", "jacket1"],
    byId,
    catalog,
    ctx
  );
  assert.equal(unchanged.title, "Schott Leather Night");
  assert.equal(
    unchanged.rationale,
    "Schott leather jacket over oxford and chinos."
  );
});

test("systemPrompt asks for verbose titles and 2–4 sentence rationales", function () {
  var prompt = suggest.systemPrompt(3);
  assert.match(prompt, /2–4 sentences|2-4 sentences/i);
  assert.match(prompt, /catchy but full/i);
  assert.match(prompt, /Wada\/palette|palette/i);
  assert.match(prompt, /occasion-led|Board-day|luggage|capsule/i);
});

test("rewriteLookCopy is occasion-led and never pastes raw session context", function () {
  var catalog = [
    {
      itemId: "shirt1",
      outfitRole: "shirt",
      type: "dress shirt",
      brandModel: "Eterna",
      fabric: "cotton",
      formality: "business",
      wadaColorIds: ["wada:v1:153"],
    },
    {
      itemId: "pants1",
      outfitRole: "trousers",
      type: "trousers",
      brandModel: "Suitsupply",
      fabric: "wool",
      formality: "business",
      wadaColorIds: ["wada:v1:157"],
    },
    {
      itemId: "jacket1",
      outfitRole: "jacket",
      type: "blazer",
      brandModel: "Rooks & Rocks",
      fabric: "wool",
      formality: "business",
      wadaColorIds: ["wada:v1:129"],
    },
    {
      itemId: "shoe1",
      outfitRole: "footwear",
      type: "shoes",
      brandModel: "Lloyd",
      fabric: "leather",
      formality: "business",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var ctx =
    "I would like you to create three outfits for me because I'm traveling next week. - Day 1: I would like something that works when traveling on a train but also when having dinner with colleagues in the evening. - Day 2: I have a board meeting to attend. - Day 3: I have some casual meetings and will travel back on a train in the evening. For luggage, I don't want to have more than two pairs of shoes, trousers, and jackets.";
  var brief = suggest.parseTripBrief(ctx, 3);
  assert.equal(brief.occasions.length, 3);
  assert.match(brief.occasions[1].shortTitle, /board/i);
  assert.equal(brief.occasions[1].formalityHint, "business");
  assert.deepEqual(brief.packing, { footwear: 2, trousers: 2, outer: 2 });

  var rewritten = suggest.rewriteLookCopy(
    {
      lookId: "2",
      title: "Dark Tyrian Blue Rooks & Rocks I would",
      rationale:
        "Dark Tyrian Blue Rooks & Rocks in wool anchors the look for I would like you to create for me because I'm traveling next wee, with White Eterna in cotton.",
      itemIds: ["shirt1", "pants1", "jacket1", "shoe1"],
    },
    byId,
    ctx,
    { brief: brief, index: 1 }
  );
  assert.ok(!/I would/i.test(rewritten.title));
  assert.ok(!/I would like you to create/i.test(rewritten.rationale));
  assert.ok(!/^Dark Tyrian Blue Rooks/i.test(rewritten.title));
  assert.match(rewritten.title, /board/i);
  assert.match(rewritten.rationale, /board/i);
  assert.ok(!/anchors the look/i.test(rewritten.rationale));
  assert.ok(!/Materials stay honest/i.test(rewritten.rationale));
  assert.ok(!/Palette-wise,/i.test(rewritten.rationale));
  var sentences = rewritten.rationale.split(/(?<=\.)\s+/).filter(Boolean);
  assert.ok(sentences.length >= 2, rewritten.rationale);
  assert.ok(sentences.length <= 4, rewritten.rationale);
  assert.equal(
    suggest.copyLooksFormulaic(
      "Board day navy",
      "Dark Tyrian Blue Rooks & Rocks in wool anchors the look, with White Eterna. Materials stay honest for the brief: wool, cotton. Palette-wise, Dark Tyrian Blue, White keep the true-color story tidy."
    ),
    true
  );
  assert.equal(
    suggest.copyLooksFormulaic(
      "Board day navy",
      "Board day leans on a navy blazer, backed by a white oxford."
    ),
    false
  );
});

test("formalityRank treats black-tie like black tie (seed spelling)", function () {
  assert.equal(suggest.formalityRank("black tie"), 5);
  assert.equal(suggest.formalityRank("black-tie"), 5);
  assert.equal(suggest.formalityRank("blacktie"), 5);
  assert.equal(suggest.formalityRank("Black-Tie"), 5);
  assert.equal(suggest.formalityRank("formal"), 4);
  assert.equal(suggest.formalityRank("business"), 3);
  assert.ok(suggest.formalityRank("black-tie") > suggest.formalityRank("casual"));
  assert.equal(suggest.formalityRank("black-tie"), suggest.formalityRank("black tie"));
});

test("beltFootwearMatchScore prefers matching leather tones", function () {
  var blackShoes = {
    itemId: "bugatti",
    outfitRole: "footwear",
    type: "shoes",
    brandModel: "Bugatti",
    fabric: "black leather",
    wadaColorIds: [],
  };
  var brownShoes = {
    itemId: "lloyd",
    outfitRole: "footwear",
    type: "shoes",
    brandModel: "Lloyd",
    fabric: "brown leather",
  };
  var blackBelt = {
    itemId: "belt-black",
    outfitRole: "belt",
    type: "leather belt",
    fabric: "black leather",
  };
  var brownBelt = {
    itemId: "belt-brown",
    outfitRole: "belt",
    type: "leather belt",
    aiContext: "cognac brown dress belt",
  };
  assert.equal(suggest.leatherToneFamily(blackShoes), "black");
  assert.equal(suggest.leatherToneFamily(brownBelt), "brown");
  assert.ok(
    suggest.beltFootwearMatchScore(blackBelt, blackShoes) >
      suggest.beltFootwearMatchScore(brownBelt, blackShoes)
  );
  assert.ok(
    suggest.beltFootwearMatchScore(brownBelt, brownShoes) >
      suggest.beltFootwearMatchScore(blackBelt, brownShoes)
  );
});

test("repairBeltFootwearMatch swaps mismatched belt for matching unused belt", function () {
  var catalog = [
    {
      itemId: "shirt1",
      outfitRole: "shirt",
      type: "shirt",
      formality: "business",
    },
    {
      itemId: "pants1",
      outfitRole: "trousers",
      type: "trousers",
      aiContext: "belt loops",
      formality: "business",
    },
    {
      itemId: "shoe-black",
      outfitRole: "footwear",
      type: "shoes",
      brandModel: "Bugatti",
      fabric: "black leather",
      formality: "business",
    },
    {
      itemId: "belt-brown",
      outfitRole: "belt",
      type: "leather belt",
      fabric: "brown leather",
    },
    {
      itemId: "belt-black",
      outfitRole: "belt",
      type: "leather belt",
      fabric: "black leather",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var repaired = suggest.repairBeltFootwearMatch(
    [
      {
        lookId: "1",
        title: "Board",
        rationale: "",
        itemIds: ["shirt1", "pants1", "shoe-black", "belt-brown"],
      },
    ],
    byId,
    catalog
  );
  assert.ok(repaired.repairs >= 1);
  assert.ok(repaired.looks[0].itemIds.indexOf("belt-black") >= 0);
  assert.ok(repaired.looks[0].itemIds.indexOf("belt-brown") < 0);
});

test("repairBeltFootwearMatch drops mismatched belt when trousers are beltless", function () {
  var catalog = [
    { itemId: "shirt1", outfitRole: "shirt", type: "shirt" },
    {
      itemId: "pants1",
      outfitRole: "trousers",
      type: "trousers",
      aiContext: "side-adjusters; no belt needed.",
    },
    {
      itemId: "shoe-black",
      outfitRole: "footwear",
      type: "shoes",
      fabric: "black leather",
    },
    {
      itemId: "belt-brown",
      outfitRole: "belt",
      type: "leather belt",
      fabric: "brown leather",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var repaired = suggest.repairBeltFootwearMatch(
    [
      {
        lookId: "1",
        itemIds: ["shirt1", "pants1", "shoe-black", "belt-brown"],
      },
    ],
    byId,
    catalog
  );
  assert.ok(repaired.repairs >= 1);
  assert.ok(repaired.looks[0].itemIds.indexOf("belt-brown") < 0);
});

test("pickWaistFinish prefers belt matching footwear leather tone", function () {
  var catalog = [
    { itemId: "shirt1", outfitRole: "shirt", type: "oxford" },
    {
      itemId: "pants1",
      outfitRole: "trousers",
      type: "chinos",
      aiContext: "belt loops",
    },
    {
      itemId: "shoe-black",
      outfitRole: "footwear",
      type: "shoes",
      fabric: "black leather",
      formality: "business",
    },
    {
      itemId: "belt-brown",
      outfitRole: "belt",
      type: "leather belt",
      fabric: "brown leather",
      formality: "business",
    },
    {
      itemId: "belt-black",
      outfitRole: "belt",
      type: "leather belt",
      fabric: "black leather",
      formality: "business",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var repaired = suggest.repairLookLocally(
    {
      lookId: "1",
      itemIds: ["shirt1", "pants1", "shoe-black"],
    },
    byId,
    catalog,
    "board meeting",
    new Set()
  );
  assert.ok(repaired.repairs.includes("attach_waist_finish"));
  assert.ok(repaired.look.itemIds.indexOf("belt-black") >= 0);
  assert.ok(repaired.look.itemIds.indexOf("belt-brown") < 0);
});

test("publicOccasions strips bodies for API/export", function () {
  var brief = suggest.parseTripBrief(
    "Day 1: train and dinner. Day 2: board meeting. Day 3: casual train home.",
    3
  );
  var rows = suggest.publicOccasions(brief);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].shortTitle.toLowerCase().indexOf("board") >= 0, true);
  assert.equal(rows[0].body, undefined);
  assert.ok(rows[0].formalityHint || rows[1].formalityHint);
});

test("parsePackingLimits defaults for trip language and parses bundled luggage", function () {
  assert.equal(suggest.parsePackingLimits("client lunch"), null);
  assert.deepEqual(suggest.parsePackingLimits("traveling next week"), {
    footwear: 2,
    trousers: 2,
    outer: 2,
  });
  assert.deepEqual(
    suggest.parsePackingLimits(
      "For luggage, I don't want to have more than two pairs of shoes, trousers, and jackets."
    ),
    { footwear: 2, trousers: 2, outer: 2 }
  );
});

test("repairCrossLookPacking reuses capsule pieces when unique counts exceed limits", function () {
  var catalog = [
    { itemId: "s1", outfitRole: "shirt", type: "shirt", formality: "business" },
    { itemId: "s2", outfitRole: "shirt", type: "shirt", formality: "smart casual" },
    { itemId: "s3", outfitRole: "shirt", type: "shirt", formality: "casual" },
    {
      itemId: "t1",
      outfitRole: "trousers",
      type: "trousers",
      formality: "business",
    },
    {
      itemId: "t2",
      outfitRole: "trousers",
      type: "trousers",
      formality: "business",
    },
    {
      itemId: "t3",
      outfitRole: "trousers",
      type: "chinos",
      formality: "smart casual",
    },
    {
      itemId: "j1",
      outfitRole: "jacket",
      type: "blazer",
      formality: "business",
    },
    {
      itemId: "j2",
      outfitRole: "jacket",
      type: "blazer",
      formality: "smart casual",
    },
    {
      itemId: "f1",
      outfitRole: "footwear",
      type: "shoes",
      formality: "business",
    },
    {
      itemId: "f2",
      outfitRole: "footwear",
      type: "shoes",
      formality: "business",
    },
    {
      itemId: "f3",
      outfitRole: "footwear",
      type: "shoes",
      formality: "smart casual",
    },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var looks = [
    {
      lookId: "1",
      title: "A",
      rationale: "",
      itemIds: ["s1", "t1", "j1", "f1"],
    },
    {
      lookId: "2",
      title: "B",
      rationale: "",
      itemIds: ["s2", "t2", "j1", "f2"],
    },
    {
      lookId: "3",
      title: "C",
      rationale: "",
      itemIds: ["s3", "t3", "j2", "f3"],
    },
  ];
  var before = suggest.packingSummary(looks, byId);
  assert.equal(before.footwear.length, 3);
  assert.equal(before.trousers.length, 3);
  assert.equal(before.outer.length, 2);

  var repaired = suggest.repairCrossLookPacking(looks, byId, {
    footwear: 2,
    trousers: 2,
    outer: 2,
  });
  assert.ok(repaired.repairs >= 2, "expected packing swaps, got " + repaired.repairs);
  assert.ok(repaired.packing.footwear.length <= 2);
  assert.ok(repaired.packing.trousers.length <= 2);
  assert.ok(repaired.packing.outer.length <= 2);
  // Capsule keeps first-seen uniques; later looks reuse them.
  assert.deepEqual(repaired.packing.footwear.sort(), ["f1", "f2"]);
  assert.ok(repaired.looks[2].itemIds.indexOf("f3") < 0);
  assert.ok(repaired.looks[2].itemIds.indexOf("t3") < 0);
});

test("extractLookCount defaults, parses digits/words, and clamps 1–8", function () {
  assert.equal(suggest.extractLookCount(""), 3);
  assert.equal(suggest.extractLookCount("client lunch, cool and dry"), 3);
  assert.equal(suggest.extractLookCount("5 looks please"), 5);
  assert.equal(suggest.extractLookCount("give me two outfits"), 2);
  assert.equal(suggest.extractLookCount("one look for the opera"), 1);
  assert.equal(suggest.extractLookCount("a look tonight"), 1);
  assert.equal(suggest.extractLookCount("looks: 7"), 7);
  assert.equal(suggest.extractLookCount("99 looks"), 8);
  assert.equal(suggest.extractLookCount("0 outfits"), 1);
  assert.equal(suggest.extractLookCount("ten looks"), 8);
  assert.equal(suggest.maxTokensForLookCount(3), 512 + 3 * 280);
  assert.equal(suggest.maxTokensForLookCount(8), 512 + 8 * 280);
  assert.ok(suggest.maxTokensForLookCount(8) > suggest.maxTokensForLookCount(3));
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

test("assembleRandomLooks honors requested lookCount", function () {
  var catalog = [
    { itemId: "a", outfitRole: "footwear", type: "loafers" },
    { itemId: "b", outfitRole: "trousers", type: "chinos" },
    { itemId: "c", outfitRole: "shirt", type: "oxford" },
    { itemId: "d", outfitRole: "outerwear", type: "blazer" },
    { itemId: "e", outfitRole: "footwear", type: "boots" },
    { itemId: "f", outfitRole: "trousers", type: "jeans" },
    { itemId: "g", outfitRole: "base", type: "knit" },
  ];
  var looks = suggest.assembleRandomLooks(catalog, {
    lookCount: 5,
    random: function () {
      return 0.2;
    },
  });
  assert.equal(looks.length, 5);
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
  assert.equal(rows[0].color, undefined);
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
      fabric: "wool",
      brandModel: "",
      formality: "business",
      pattern: "solid",
      season: "all-season",
      outfitRole: "trousers",
      wadaColorIds: ["wada:v1:999"],
    },
  ]);
  assert.equal(rows[0].color, undefined);
  assert.equal(rows[0].wada, "Seashell Pink");
  assert.equal(rows[0].wadaId, "wada:v1:42");
  assert.equal(rows[0].wadaColorIds, undefined);
  assert.equal(rows[1].wada, undefined);
  assert.equal(rows[1].wadaId, undefined);
  assert.equal(rows[2].wada, undefined);
  assert.equal(rows[2].wadaId, undefined);
  var dumped = JSON.stringify(rows);
  assert.ok(!/wadaColorIds/i.test(dumped));
  assert.ok(!/"color"/i.test(dumped));
  assert.ok(!/combination/i.test(dumped));
});

test("systemPrompt mentions Wada colour reference and mandatory core", function () {
  var prompt = suggest.systemPrompt();
  assert.match(prompt, /wada/i);
  assert.match(prompt, /colour/i);
  assert.doesNotMatch(prompt, /free-text color/i);
  assert.match(prompt, /Never invent item IDs/);
  assert.match(prompt, /mandatory core/i);
  assert.match(prompt, /Slot uniqueness/i);
  assert.match(prompt, /Never two shoes/i);
  assert.match(prompt, /Title and rationale must name only pieces/i);
  assert.match(prompt, /Accessories beyond waist finish remain optional/i);
  assert.match(prompt, /title/);
  assert.match(prompt, /exactly 3 distinct looks/);
  assert.match(prompt, /DressMe style pack v1/);
  assert.match(prompt, /Soft Sanzo Wada combination prior/);
  assert.match(prompt, /missing_waist_finish|waist finish|suspenders/i);
  assert.match(prompt, /Match belt leather tone|brown belt with black/i);
  assert.match(prompt, /cold|warm layer|garden/i);
  var five = suggest.systemPrompt(5);
  assert.match(five, /exactly 5 distinct looks/);
  assert.match(five, /"lookId":"5"/);
});

test("contextNeedsColdLayer detects cold/outdoor garden cues", function () {
  assert.equal(suggest.contextNeedsColdLayer("client lunch, cool and dry"), true);
  assert.equal(
    suggest.contextNeedsColdLayer("evening garden party outdoors — 4 looks"),
    true
  );
  assert.equal(suggest.contextNeedsColdLayer("hot indoor office"), false);
  assert.equal(suggest.contextNeedsColdLayer(""), false);
});

test("waist finish heuristics: side-adjusters exempt; suspenders capable", function () {
  var looped = {
    itemId: "pants",
    outfitRole: "trousers",
    type: "wool trousers",
    aiContext: "belt loops; navy.",
  };
  var sideAdj = {
    itemId: "pants2",
    outfitRole: "trousers",
    type: "trousers",
    aiContext: "side-adjusters; no belt needed.",
  };
  var suspPants = {
    itemId: "pants3",
    outfitRole: "trousers",
    type: "dress trousers",
    aiContext: "suspender buttons; braces friendly.",
  };
  assert.equal(suggest.trousersNeedWaistFinish(looped), true);
  assert.equal(suggest.trousersNeedWaistFinish(sideAdj), false);
  assert.equal(suggest.trousersSuspenderCapable(suspPants), true);
  assert.equal(suggest.trousersSuspenderCapable(looped), false);
  assert.equal(
    suggest.isBeltItem({ outfitRole: "belt", type: "leather belt" }),
    true
  );
  assert.equal(
    suggest.isSuspendersItem({
      outfitRole: "suspenders",
      type: "braces",
      aiContext: "navy suspenders",
    }),
    true
  );
});

test("repairLookLocally attaches cold layer and waist finish when closet can fill", function () {
  var catalog = [
    { itemId: "shoes-1", outfitRole: "footwear", type: "loafers", formality: "business" },
    { itemId: "pants-1", outfitRole: "trousers", type: "chinos", aiContext: "belt loops" },
    { itemId: "shirt-1", outfitRole: "shirt", type: "oxford" },
    { itemId: "blazer-1", outfitRole: "outerwear", type: "blazer" },
    { itemId: "belt-1", outfitRole: "belt", type: "leather belt", formality: "business" },
  ];
  var byId = new Map(
    catalog.map(function (row) {
      return [row.itemId, row];
    })
  );
  var repaired = suggest.repairLookLocally(
    { lookId: "1", itemIds: ["shirt-1", "pants-1", "shoes-1"] },
    byId,
    catalog,
    "cold evening garden party",
    new Set()
  );
  assert.ok(repaired.repairs.includes("attach_layer_for_cold"));
  assert.ok(repaired.repairs.includes("attach_waist_finish"));
  assert.ok(repaired.look.itemIds.includes("blazer-1"));
  assert.ok(repaired.look.itemIds.includes("belt-1"));
  var ok = suggest.assertLooksComplete(
    [repaired.look],
    byId,
    catalog,
    "cold evening garden party"
  );
  assert.equal(ok.incomplete.length, 0);
});

test("modelId prefers SUGGEST_MODEL_ID over BEDROCK_MODEL_ID", function () {
  var prevSuggest = process.env.SUGGEST_MODEL_ID;
  var prevBedrock = process.env.BEDROCK_MODEL_ID;
  try {
    process.env.BEDROCK_MODEL_ID = "haiku-test";
    delete process.env.SUGGEST_MODEL_ID;
    assert.equal(suggest.modelId(), "haiku-test");
    process.env.SUGGEST_MODEL_ID = "sonnet-test";
    assert.equal(suggest.modelId(), "sonnet-test");
  } finally {
    if (prevSuggest == null) delete process.env.SUGGEST_MODEL_ID;
    else process.env.SUGGEST_MODEL_ID = prevSuggest;
    if (prevBedrock == null) delete process.env.BEDROCK_MODEL_ID;
    else process.env.BEDROCK_MODEL_ID = prevBedrock;
  }
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

test("POST /api/suggest honors look count from context for random engine", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var ok = await api.handler({
    rawPath: "/api/suggest",
    requestContext: { http: { method: "POST", path: "/api/suggest" } },
    body: JSON.stringify({
      context: "Tuesday client lunch — 5 looks please",
    }),
  });
  assert.equal(ok.statusCode, 200);
  var body = JSON.parse(ok.body);
  assert.equal(body.looks.length, 5);
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
      assert.equal(input.inferenceConfig.maxTokens, suggest.maxTokensForLookCount(3));
      var systemText = input.system[0].text;
      assert.match(systemText, /exactly 3 distinct looks/);
      var userText = input.messages[0].content[0].text;
      assert.match(userText, /Catalog JSON:/);
      assert.match(userText, /exactly 3 looks now/);
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
        context: "board meeting tomorrow morning",
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
  assert.equal(body.context, "board meeting tomorrow morning");
  assert.equal(body.looks.length, 3);
  assert.match(body.looks[0].rationale, /Navy blazer/);
  assert.equal(body.looks[0].title, "Boardroom Navy");
  assert.ok(body.looks[0].items.length >= 1);
  assert.ok(body.looks[0].items[0].photos[0].thumbUrl || body.looks[0].items[0].photos[0].url);
  assert.equal(calls.length, 1);
  assert.equal(body.requestedLookCount, 3);
  assert.equal(body.lookCountShortfall, undefined);

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

test("Bedrock engine honors five looks from context and bumps maxTokens", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var calls = [];
  suggest.resetDepsForTests({
    converse: async function (input) {
      calls.push(input);
      assert.equal(input.inferenceConfig.maxTokens, suggest.maxTokensForLookCount(5));
      assert.match(input.system[0].text, /exactly 5 distinct looks/);
      assert.match(input.messages[0].content[0].text, /exactly 5 looks now/);
      return mockBedrockLooks(null, 5);
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({
        context: "board meeting — 5 looks please",
        engine: "bedrock",
      }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.looks.length, 5);
  assert.equal(calls.length, 1);
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

test("Bedrock path constructs ConverseCommand when deps.converse is unset", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var sent = [];
  suggest.resetDepsForTests({
    bedrock: {
      send: async function (command) {
        sent.push(command);
        assert.equal(command.constructor.name, "ConverseCommand");
        return mockBedrockLooks();
      },
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({
        context: "board meeting tomorrow morning",
        engine: "bedrock",
      }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  assert.equal(sent.length >= 1, true);
  assert.equal(JSON.parse(res.body).looks.length, 3);
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

test("Bedrock salvages competing bases without repair", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);
  seedItem(memory, {
    itemId: "knit-1",
    type: "sweater",
    fabric: "wool",
    brandModel: "John Smedley",
    formality: "smart casual",
    pattern: "solid",
    season: "fall",
    outfitRole: "knitwear",
  });

  var call = 0;
  suggest.resetDepsForTests({
    converse: async function () {
      call += 1;
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  looks: [
                    {
                      lookId: "1",
                      title: "Two Tops",
                      itemIds: ["shirt-1", "knit-1", "pants-1", "shoes-1"],
                      rationale: "stacked bases",
                    },
                    {
                      lookId: "2",
                      title: "Clean",
                      itemIds: ["knit-1", "pants-1", "shoes-1"],
                      rationale: "ok",
                    },
                    {
                      lookId: "3",
                      title: "Blazer",
                      itemIds: ["shirt-1", "pants-1", "blazer-1", "shoes-1"],
                      rationale: "layered",
                    },
                  ],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 20, outputTokens: 40 },
      };
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({ context: "office", engine: "bedrock" }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.looks.length, 3);
  assert.equal(call, 1);
  var look1Ids = body.looks[0].items.map(function (row) {
    return row.itemId;
  });
  assert.ok(look1Ids.includes("shirt-1"));
  assert.ok(!look1Ids.includes("knit-1"));
});

test("Bedrock incomplete looks get local core repair instead of hard-fail", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedClassicCatalog(memory);

  var call = 0;
  suggest.resetDepsForTests({
    converse: async function () {
      call += 1;
      // Missing trousers → Bedrock repair may still miss; local attach fills pants.
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

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.ok(body.looks.length >= 1);
  assert.equal(body.requestedLookCount, 3);
  assert.equal(body.returnedLookCount, body.looks.length);
  for (var i = 0; i < body.looks.length; i++) {
    var ids = body.looks[i].items.map(function (row) {
      return row.itemId;
    });
    assert.ok(ids.includes("pants-1"), "local repair attaches trousers");
  }
  assert.ok(call >= 1 && call <= 2);
});

test("Bedrock skips optional fill when second-pass time budget is exhausted", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  seedItem(memory, {
    itemId: "shoes-1",
    type: "loafers",
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
    fabric: "cotton",
    brandModel: "Gitman",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "shirt",
  });

  var call = 0;
  var clock = 0;
  suggest.resetDepsForTests({
    now: function () {
      return clock;
    },
    converse: async function () {
      call += 1;
      // After the primary returns, jump past the second-pass deadline.
      clock = suggest.SECOND_PASS_DEADLINE_MS + 1;
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  looks: [
                    {
                      lookId: "1",
                      title: "Only One",
                      itemIds: ["shirt-1", "pants-1", "shoes-1"],
                      rationale: "core",
                    },
                    {
                      lookId: "2",
                      title: "Ghost",
                      itemIds: ["nope-a"],
                      rationale: "bad",
                    },
                    {
                      lookId: "3",
                      title: "Ghost2",
                      itemIds: ["nope-b"],
                      rationale: "bad",
                    },
                    {
                      lookId: "4",
                      title: "Ghost3",
                      itemIds: ["nope-c"],
                      rationale: "bad",
                    },
                  ],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 9, outputTokens: 9 },
      };
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({
        context: "garden party — 4 looks please",
        engine: "bedrock",
      }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  assert.equal(call, 1, "fill/repair Bedrock pass skipped under time budget");
  var body = JSON.parse(res.body);
  assert.equal(body.requestedLookCount, 4);
  assert.ok(body.returnedLookCount >= 1);
  assert.ok(body.returnedLookCount < 4);
  assert.equal(body.lookCountShortfall, true);
});

test("Bedrock shortfall flags when closet cannot reach requested N", async function () {
  var memory = makeMemoryDeps();
  items.resetDepsForTests(memory);
  // Tiny closet: only enough pieces for one complete look.
  seedItem(memory, {
    itemId: "shoes-1",
    type: "loafers",
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
    fabric: "cotton",
    brandModel: "Gitman",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "shirt",
  });

  var call = 0;
  suggest.resetDepsForTests({
    converse: async function () {
      call += 1;
      // First call: one complete look + blanks (hallucinated IDs strip empty).
      // Second call (id/completeness repair or fill): still only one complete.
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  looks: [
                    {
                      lookId: "1",
                      title: "Only One",
                      itemIds: ["shirt-1", "pants-1", "shoes-1"],
                      rationale: "core",
                    },
                    {
                      lookId: "2",
                      title: "Ghost",
                      itemIds: ["nope-a"],
                      rationale: "bad",
                    },
                    {
                      lookId: "3",
                      title: "Ghost2",
                      itemIds: ["nope-b"],
                      rationale: "bad",
                    },
                    {
                      lookId: "4",
                      title: "Ghost3",
                      itemIds: ["nope-c"],
                      rationale: "bad",
                    },
                  ],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 9, outputTokens: 9 },
      };
    },
  });

  var res;
  try {
    res = await api.handler({
      rawPath: "/api/suggest",
      requestContext: { http: { method: "POST", path: "/api/suggest" } },
      body: JSON.stringify({
        context: "garden party — 4 looks please",
        engine: "bedrock",
      }),
    });
  } finally {
    suggest.resetDepsForTests({});
  }

  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.requestedLookCount, 4);
  assert.ok(body.returnedLookCount >= 1);
  assert.ok(body.returnedLookCount < 4);
  assert.equal(body.lookCountShortfall, true);
  assert.equal(body.looks.length, body.returnedLookCount);
  assert.ok(call >= 1);
});

test("catalogCapMeta flags when closet exceeds soft cap", function () {
  var cap = suggest.SOFT_CATALOG_CAP;
  // Headroom for ~200+ closet + ties/hats without always truncating.
  assert.ok(cap >= 240);
  var under = [];
  for (var i = 0; i < cap; i++) under.push({ itemId: "i" + i });
  var metaUnder = suggest.catalogCapMeta(under);
  assert.equal(metaUnder.catalogCapped, false);
  assert.equal(metaUnder.catalogTotal, cap);
  assert.equal(metaUnder.catalogUsed, cap);

  var over = under.concat([{ itemId: "extra" }]);
  var metaOver = suggest.catalogCapMeta(over);
  assert.equal(metaOver.catalogCapped, true);
  assert.equal(metaOver.catalogTotal, cap + 1);
  assert.equal(metaOver.catalogUsed, cap);

  var rows = suggest.serializeCatalogForPrompt(over);
  assert.equal(rows.length, cap);
});

test("formalityHintFromText ranks black-tie / formal above business board", function () {
  assert.equal(suggest.formalityHintFromText("black-tie gala"), "black tie");
  assert.equal(suggest.formalityHintFromText("opera night"), "black tie");
  assert.equal(suggest.formalityHintFromText("formal dinner"), "formal");
  assert.equal(suggest.formalityHintFromText("board meeting"), "business");
  assert.ok(
    suggest.formalityRank(suggest.formalityHintFromText("black tie event")) >
      suggest.formalityRank(suggest.formalityHintFromText("board meeting"))
  );
});

test("selectCatalogForPrompt prefers formal pieces for formal requests", function () {
  var cap = suggest.SOFT_CATALOG_CAP;
  var catalog = [];
  // Flood the closet with casual pieces so a naive slice would drown formal ones.
  for (var i = 0; i < cap + 40; i++) {
    catalog.push({
      itemId: "casual-" + i,
      type: "polo",
      formality: "casual",
      outfitRole: "base",
      createdAt: "2020-01-" + String((i % 28) + 1).padStart(2, "0"),
    });
  }
  var formalIds = [
    "bt-jacket",
    "bt-trouser",
    "bt-shoe",
    "bt-shirt",
    "formal-tie",
  ];
  formalIds.forEach(function (id, idx) {
    catalog.push({
      itemId: id,
      type: idx === 4 ? "tie" : idx === 2 ? "oxford" : idx === 1 ? "trouser" : "jacket",
      formality: idx < 4 ? "black-tie" : "formal",
      // Tie may lack outfitRole — type/slot fallback must still keep it.
      outfitRole: idx === 4 ? "" : idx === 2 ? "footwear" : idx === 1 ? "trousers" : "jacket",
      createdAt: "2024-06-0" + (idx + 1),
    });
  });
  // Incomplete attrs should not crash subsetting; low priority vs formal match.
  catalog.push({
    itemId: "mystery",
    type: "",
    formality: "",
    outfitRole: "",
    createdAt: "2025-01-01",
  });

  assert.equal(suggest.targetFormalityRankFromContext("black-tie gala, 3 looks"), 5);

  var selected = suggest.selectCatalogForPrompt(catalog, "black-tie gala");
  assert.equal(selected.length, cap);
  var selectedIds = {};
  for (var s = 0; s < selected.length; s++) {
    selectedIds[selected[s].itemId] = true;
  }
  for (var f = 0; f < formalIds.length; f++) {
    assert.equal(
      selectedIds[formalIds[f]],
      true,
      "expected formal piece in subset: " + formalIds[f]
    );
  }
  // Mystery incomplete row should lose to request-matched pieces when over cap.
  assert.equal(selectedIds.mystery, undefined);

  var serialized = suggest.serializeCatalogForPrompt(catalog, "formal black-tie dinner");
  assert.equal(serialized.length, cap);
  var serIds = serialized.map(function (r) {
    return r.id;
  });
  assert.ok(serIds.indexOf("bt-jacket") >= 0);
  assert.ok(serIds.indexOf("bt-shoe") >= 0);
});

test("selectCatalogForPrompt falls back when context has no formality hint", function () {
  var cap = suggest.SOFT_CATALOG_CAP;
  var catalog = [];
  for (var i = 0; i < cap + 5; i++) {
    catalog.push({
      itemId: "bare-" + i,
      type: "",
      formality: "",
      outfitRole: "",
      createdAt: "2021-01-" + String((i % 28) + 1).padStart(2, "0"),
    });
  }
  // Attrs-complete-ish rows should still win without a formality cue.
  catalog.push({
    itemId: "role-only",
    type: "chino",
    formality: "",
    outfitRole: "trousers",
    createdAt: "2022-01-01",
  });
  catalog.push({
    itemId: "formality-only",
    type: "loafer",
    formality: "smart casual",
    outfitRole: "",
    createdAt: "2022-01-02",
  });

  var selected = suggest.selectCatalogForPrompt(catalog, "pick something nice");
  assert.equal(selected.length, cap);
  var ids = {};
  for (var j = 0; j < selected.length; j++) ids[selected[j].itemId] = true;
  assert.equal(ids["role-only"], true);
  assert.equal(ids["formality-only"], true);
});
