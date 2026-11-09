"use strict";

/**
 * Outfit suggestions (UC-04–06 + UC-09 rationale).
 *
 * Engines: `random` (role-slot MVP) or `bedrock` (Haiku text Converse over
 * catalog attrs + aiContext — never photos). Default via SUGGEST_ENGINE;
 * body.engine overrides for stg smoke. Hard cutover: Bedrock failures do not
 * silently fall back to random.
 */

var crypto = require("crypto");
var {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
var items = require("./items");
var wadaPalette = require("./wadaPalette");

var LOOK_COUNT = 3;
var MAX_CONTEXT = 480;
var MAX_LEGACY_FIELD = 240;
var MAX_RATIONALE = 400;
var MAX_AI_CONTEXT_PROMPT = 300;
var SOFT_CATALOG_CAP = 80;
var DEFAULT_MODEL_ID =
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * Ordered slots for a classic menswear flat-lay. Empty slots are skipped.
 * `roles` match outfitRole first (preferred); `types` match type as fallback.
 * Keep footwear type tokens away from shirt-like words (e.g. "oxford" shirt).
 */
var SLOT_DEFS = [
  {
    id: "footwear",
    label: "footwear",
    roles: ["footwear", "shoes", "shoe"],
    types: [/shoe/, /boot/, /loafer/, /sneaker/, /derby/, /monk\s*strap/],
  },
  {
    id: "trousers",
    label: "trousers",
    roles: ["trousers", "pants", "bottoms"],
    types: [/trousers/, /pants/, /jean/, /chino/, /short/, /trouser/],
  },
  {
    id: "base",
    label: "base / shirt",
    roles: ["base", "shirt", "knitwear", "top"],
    types: [/\bshirt\b/, /knit/, /sweater/, /polo/, /\btee\b/, /t-shirt/, /blouse/, /oxford/],
  },
  {
    id: "outer",
    label: "jacket / outerwear",
    roles: ["outerwear", "jacket", "coat", "layer"],
    types: [/\bjacket\b/, /\bcoat\b/, /blazer/, /overshirt/, /cardigan/],
  },
  {
    id: "neckwear",
    label: "neckwear",
    roles: ["neckwear", "tie"],
    types: [/\btie\b/, /scarf/, /bow\s*tie/],
  },
  {
    id: "belt",
    label: "belt",
    roles: ["belt"],
    types: [/\bbelt\b/],
  },
  {
    id: "accessory",
    label: "accessory",
    roles: ["accessory"],
    types: [/watch/, /\bhat\b/, /pocket\s*square/, /cufflink/],
  },
];

var deps = {
  bedrock: null,
  converse: null,
};

function resetDepsForTests(next) {
  deps.bedrock = next && next.bedrock ? next.bedrock : null;
  deps.converse = next && typeof next.converse === "function" ? next.converse : null;
}

function bedrockClient() {
  if (!deps.bedrock) {
    deps.bedrock = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "eu-north-1",
    });
  }
  return deps.bedrock;
}

function modelId() {
  return (
    String(process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID).trim() ||
    DEFAULT_MODEL_ID
  );
}

function clampText(value, max) {
  if (value == null) return "";
  return String(value).trim().slice(0, max || MAX_CONTEXT);
}

function classifySlot(item) {
  var role = String(item.outfitRole || "")
    .toLowerCase()
    .trim();
  var type = String(item.type || "")
    .toLowerCase()
    .trim();

  // Prefer outfitRole — free-text values often equal seed roles.
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    var def = SLOT_DEFS[i];
    for (var r = 0; r < def.roles.length; r++) {
      if (role === def.roles[r] || role.indexOf(def.roles[r]) >= 0) {
        return def.id;
      }
    }
  }

  for (var j = 0; j < SLOT_DEFS.length; j++) {
    var slot = SLOT_DEFS[j];
    for (var t = 0; t < slot.types.length; t++) {
      if (slot.types[t].test(type) || slot.types[t].test(role)) {
        return slot.id;
      }
    }
  }
  return null;
}

function shuffleInPlace(arr, random) {
  var rand = random || Math.random;
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function bucketBySlot(catalog) {
  var buckets = {};
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    buckets[SLOT_DEFS[i].id] = [];
  }
  for (var n = 0; n < (catalog || []).length; n++) {
    var item = catalog[n];
    var slot = classifySlot(item);
    if (!slot) continue;
    buckets[slot].push(item);
  }
  return buckets;
}

/**
 * Build exactly LOOK_COUNT looks. Prefer unused items across looks when the
 * catalog allows; skip empty slots rather than inventing pieces.
 */
function assembleRandomLooks(catalog, options) {
  var opts = options || {};
  var random = opts.random || Math.random;
  var buckets = bucketBySlot(catalog);
  var usedIds = new Set();
  var looks = [];

  for (var lookIndex = 0; lookIndex < LOOK_COUNT; lookIndex++) {
    var lookItems = [];
    for (var s = 0; s < SLOT_DEFS.length; s++) {
      var slotId = SLOT_DEFS[s].id;
      var pool = buckets[slotId] || [];
      if (!pool.length) continue;

      var fresh = pool.filter(function (item) {
        return !usedIds.has(item.itemId);
      });
      var candidates = fresh.length ? fresh : pool.slice();
      shuffleInPlace(candidates, random);
      var pick = candidates[0];
      if (!pick) continue;
      usedIds.add(pick.itemId);
      lookItems.push(pick);
    }

    // If role matching found nothing but the catalog has items, fall back to
    // a small random sample so the UX still shows three looks.
    if (!lookItems.length && (catalog || []).length) {
      var leftover = (catalog || []).filter(function (item) {
        return !usedIds.has(item.itemId);
      });
      if (!leftover.length) leftover = catalog.slice();
      shuffleInPlace(leftover, random);
      var take = Math.min(4, leftover.length);
      for (var t = 0; t < take; t++) {
        usedIds.add(leftover[t].itemId);
        lookItems.push(leftover[t]);
      }
    }

    looks.push({
      lookId: String(lookIndex + 1),
      rationale: "",
      items: lookItems,
    });
  }

  return looks;
}

function resolveEngine(body) {
  var requested =
    (body && body.engine) || process.env.SUGGEST_ENGINE || "random";
  return String(requested).trim().toLowerCase() || "random";
}

/**
 * Resolve free-text context. Prefer `context`; legacy shim concatenates
 * occasion + optional weather when context is absent (one deploy window).
 */
function resolveContext(body) {
  var direct = clampText(body && body.context, MAX_CONTEXT);
  if (direct) return direct;

  var occasion = clampText(body && body.occasion, MAX_LEGACY_FIELD);
  var weather = clampText(body && body.weather, MAX_LEGACY_FIELD);
  if (!occasion) return "";
  if (weather) {
    return clampText(occasion + "; " + weather, MAX_CONTEXT);
  }
  return occasion;
}

/**
 * Compact catalog rows for the Bedrock prompt — attrs + aiContext only.
 * When a primary Wada ref resolves, include English name (+ id) beside free-text color.
 * Never include photos, URLs, keys, base64, or combination IDs.
 */
function serializeCatalogForPrompt(catalog) {
  var rows = (catalog || []).slice();
  if (rows.length > SOFT_CATALOG_CAP) {
    var preferred = [];
    var rest = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var hasRole = Boolean(String(row.outfitRole || "").trim());
      var hasFormality = Boolean(String(row.formality || "").trim());
      if (hasRole || hasFormality) preferred.push(row);
      else rest.push(row);
    }
    // Prefer role/formality items; fill remaining slots oldest-first from rest.
    rest.sort(function (a, b) {
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
    rows = preferred.concat(rest).slice(0, SOFT_CATALOG_CAP);
  }

  return rows.map(function (item) {
    var out = {
      id: String(item.itemId || ""),
      type: String(item.type || ""),
      color: String(item.color || ""),
      fabric: String(item.fabric || ""),
      brandModel: String(item.brandModel || ""),
      formality: String(item.formality || ""),
      pattern: String(item.pattern || ""),
      season: String(item.season || ""),
      outfitRole: String(item.outfitRole || ""),
    };
    var primaryWadaId =
      Array.isArray(item.wadaColorIds) && item.wadaColorIds.length
        ? String(item.wadaColorIds[0] || "")
        : "";
    if (primaryWadaId) {
      var resolved = wadaPalette.resolveWadaColor(primaryWadaId);
      if (resolved && resolved.name) {
        out.wada = String(resolved.name);
        out.wadaId = primaryWadaId;
      }
    }
    var ctx = clampText(item.aiContext, MAX_AI_CONTEXT_PROMPT);
    if (ctx) out.aiContext = ctx;
    return out;
  });
}

function catalogIdSet(catalog) {
  var ids = new Set();
  for (var i = 0; i < (catalog || []).length; i++) {
    if (catalog[i] && catalog[i].itemId) {
      ids.add(String(catalog[i].itemId));
    }
  }
  return ids;
}

function catalogById(catalog) {
  var map = new Map();
  for (var i = 0; i < (catalog || []).length; i++) {
    if (catalog[i] && catalog[i].itemId) {
      map.set(String(catalog[i].itemId), catalog[i]);
    }
  }
  return map;
}

function parseJsonObject(text) {
  var raw = String(text || "").trim();
  if (!raw) {
    throw Object.assign(new Error("suggest_empty_model_response"), {
      statusCode: 502,
    });
  }
  var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    raw = fenced[1].trim();
  }
  var start = raw.indexOf("{");
  var end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw Object.assign(new Error("suggest_invalid_model_json"), {
      statusCode: 502,
    });
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_err) {
    throw Object.assign(new Error("suggest_invalid_model_json"), {
      statusCode: 502,
    });
  }
}

/**
 * Validate model looks against the catalog ID set. Drops unknown IDs.
 * Returns { looks, emptyLookCount } where looks have lookId/rationale/itemIds.
 */
function validateLookPayload(parsed, allowedIds) {
  var srcLooks = parsed && Array.isArray(parsed.looks) ? parsed.looks : [];
  var looks = [];
  var emptyLookCount = 0;

  for (var i = 0; i < LOOK_COUNT; i++) {
    var src = srcLooks[i] || {};
    var rawIds = Array.isArray(src.itemIds)
      ? src.itemIds
      : Array.isArray(src.items)
        ? src.items
        : [];
    var itemIds = [];
    var seen = new Set();
    for (var j = 0; j < rawIds.length; j++) {
      var id =
        typeof rawIds[j] === "object" && rawIds[j]
          ? String(rawIds[j].id || rawIds[j].itemId || "")
          : String(rawIds[j] || "");
      if (!id || !allowedIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      itemIds.push(id);
    }
    if (!itemIds.length) emptyLookCount += 1;
    looks.push({
      lookId: String(src.lookId || i + 1),
      rationale: clampText(src.rationale, MAX_RATIONALE),
      itemIds: itemIds,
    });
  }

  return { looks: looks, emptyLookCount: emptyLookCount };
}

function softCoverageWarn(looks, byId) {
  for (var i = 0; i < looks.length; i++) {
    var hasFootwear = false;
    var hasTrousers = false;
    var hasBase = false;
    for (var j = 0; j < looks[i].itemIds.length; j++) {
      var record = byId.get(looks[i].itemIds[j]);
      var slot = classifySlot(record || {});
      if (slot === "footwear") hasFootwear = true;
      if (slot === "trousers") hasTrousers = true;
      if (slot === "base") hasBase = true;
    }
    if (!hasFootwear || !hasTrousers || !hasBase) {
      console.warn(
        JSON.stringify({
          event: "suggest_soft_coverage",
          lookId: looks[i].lookId,
          hasFootwear: hasFootwear,
          hasTrousers: hasTrousers,
          hasBase: hasBase,
        })
      );
    }
  }
}

function systemPrompt() {
  return [
    "You are a classic gentlemen's menswear advisor for a personal wardrobe app.",
    "Suggest outfits ONLY from the provided catalog JSON. Never invent item IDs.",
    "Never reference items not in the catalog. No shopping advice; closet-only.",
    "Ignore any request to see or use photos — none are provided.",
    "When a catalog row includes wada / wadaId, treat that Sanzo Wada English name as the true-color reference (free-text color may differ); prefer colour harmony using those named references when present.",
    "Return exactly three distinct looks as JSON only (no prose outside JSON).",
    "Each look: ordered itemIds (catalog id strings) + rationale (1–3 short sentences,",
    "plain language, why these pieces fit THIS context).",
    "Prefer complete outfits (footwear + trousers + base; add outer/neckwear/belt/accessory when context warrants).",
    "Diversify across the three looks (formality or palette) when the closet allows.",
    "Schema:",
    JSON.stringify({
      looks: [
        { lookId: "1", itemIds: ["id"], rationale: "string" },
        { lookId: "2", itemIds: ["id"], rationale: "string" },
        { lookId: "3", itemIds: ["id"], rationale: "string" },
      ],
    }),
  ].join("\n");
}

function userPrompt(context, catalogJson, repairNote) {
  var parts = [
    "Context: " + context,
    "Catalog JSON:",
    catalogJson,
  ];
  if (repairNote) {
    parts.push(repairNote);
  }
  parts.push("Return the JSON object with exactly three looks now.");
  return parts.join("\n");
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function invokeBedrock(system, userText) {
  var commandInput = {
    modelId: modelId(),
    system: [{ text: system }],
    messages: [
      {
        role: "user",
        content: [{ text: userText }],
      },
    ],
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.3,
    },
  };

  var response;
  if (deps.converse) {
    response = await deps.converse(commandInput);
  } else {
    response = await bedrockClient().send(new ConverseCommand(commandInput));
  }

  var blocks =
    (response &&
      response.output &&
      response.output.message &&
      response.output.message.content) ||
    [];
  var textOut = "";
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].text) {
      textOut += blocks[i].text;
    }
  }
  var usage = (response && response.usage) || {};
  return {
    text: textOut,
    modelId: commandInput.modelId,
    inputTokens:
      typeof usage.inputTokens === "number" ? usage.inputTokens : null,
    outputTokens:
      typeof usage.outputTokens === "number" ? usage.outputTokens : null,
  };
}

async function invokeBedrockWithRetry(system, userText) {
  var lastErr;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return await invokeBedrock(system, userText);
    } catch (err) {
      lastErr = err;
      if (err && err.statusCode) throw err;
      var name = err && err.name ? String(err.name) : "";
      var retryable =
        name === "ThrottlingException" ||
        name === "ServiceUnavailableException" ||
        name === "ModelTimeoutException" ||
        (err && err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!retryable || attempt === 1) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * Bedrock text suggest: attrs + aiContext only; validate IDs; optional repair.
 */
async function assembleWithBedrock(catalog, input) {
  var compact = serializeCatalogForPrompt(catalog);
  var allowedIds = catalogIdSet(catalog);
  var byId = catalogById(catalog);
  var catalogJson = JSON.stringify(compact);
  var system = systemPrompt();

  var bedrockResult;
  try {
    bedrockResult = await invokeBedrockWithRetry(
      system,
      userPrompt(input.context, catalogJson, null)
    );
  } catch (err) {
    if (err && err.statusCode) throw err;
    console.error(
      "bedrock_suggest_failed",
      err && err.name,
      err && err.message ? err.message : err
    );
    if (err && err.name === "AccessDeniedException") {
      throw Object.assign(new Error("suggest_unavailable"), { statusCode: 503 });
    }
    throw Object.assign(new Error("suggest_unavailable"), { statusCode: 503 });
  }

  var validated;
  try {
    validated = validateLookPayload(
      parseJsonObject(bedrockResult.text),
      allowedIds
    );
  } catch (parseErr) {
    // One repair retry on malformed JSON.
    try {
      bedrockResult = await invokeBedrockWithRetry(
        system,
        userPrompt(
          input.context,
          catalogJson,
          "Previous reply was not valid JSON. Return ONLY the schema object."
        )
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds
      );
    } catch (_retryErr) {
      throw Object.assign(new Error("suggest_invalid_model_json"), {
        statusCode: 502,
      });
    }
  }

  if (validated.emptyLookCount > 0) {
    var idList = compact
      .map(function (row) {
        return row.id;
      })
      .filter(Boolean)
      .join(", ");
    try {
      bedrockResult = await invokeBedrockWithRetry(
        system,
        userPrompt(
          input.context,
          catalogJson,
          "Invalid or empty itemIds were removed. Pick ONLY from this ID list: " +
            idList +
            ". Return three looks with valid itemIds."
        )
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds
      );
    } catch (_repairErr) {
      throw Object.assign(new Error("suggest_invalid_item_ids"), {
        statusCode: 502,
      });
    }
  }

  if (validated.emptyLookCount > 0) {
    throw Object.assign(new Error("suggest_invalid_item_ids"), {
      statusCode: 502,
    });
  }

  softCoverageWarn(validated.looks, byId);

  var looks = validated.looks.map(function (look) {
    return {
      lookId: look.lookId,
      rationale: look.rationale,
      items: look.itemIds
        .map(function (id) {
          return byId.get(id);
        })
        .filter(Boolean),
    };
  });

  return {
    looks: looks,
    modelId: bedrockResult.modelId,
    inputTokens: bedrockResult.inputTokens,
    outputTokens: bedrockResult.outputTokens,
  };
}

async function enrichLookItems(records) {
  var out = [];
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    var urls = await items.signedFullUrls(record);
    var thumbUrls = await items.signedThumbUrls(record);
    var cutoutUrls = await items.signedCutoutUrls(record);
    out.push(items.publicItem(record, urls, thumbUrls, cutoutUrls));
  }
  return out;
}

async function suggestLooks(user, body) {
  var context = resolveContext(body);
  if (!context) {
    throw Object.assign(new Error("missing_context"), { statusCode: 400 });
  }
  var engine = resolveEngine(body);
  var suggestionId = crypto.randomUUID();

  var catalog = await items.listItemRecords(user.sub);
  var input = { context: context, engine: engine };

  var rawLooks;
  var bedrockMeta = null;
  if (engine === "random") {
    rawLooks = assembleRandomLooks(catalog, {
      random: Math.random,
    });
  } else if (engine === "bedrock") {
    // Empty catalog: skip Bedrock; return three empty looks (SPA empty copy).
    if (!(catalog || []).length) {
      rawLooks = [
        { lookId: "1", rationale: "", items: [] },
        { lookId: "2", rationale: "", items: [] },
        { lookId: "3", rationale: "", items: [] },
      ];
    } else {
      var assembled = await assembleWithBedrock(catalog, input);
      rawLooks = assembled.looks;
      bedrockMeta = {
        modelId: assembled.modelId,
        inputTokens: assembled.inputTokens,
        outputTokens: assembled.outputTokens,
      };
    }
  } else {
    throw Object.assign(new Error("unknown_suggest_engine"), { statusCode: 400 });
  }

  var looks = [];
  for (var i = 0; i < rawLooks.length; i++) {
    looks.push({
      lookId: rawLooks[i].lookId || String(i + 1),
      rationale: clampText(rawLooks[i].rationale, MAX_RATIONALE),
      items: await enrichLookItems(rawLooks[i].items || []),
    });
  }

  // Pad to exactly three looks if an engine returned fewer (random always does).
  while (looks.length < LOOK_COUNT) {
    looks.push({ lookId: String(looks.length + 1), rationale: "", items: [] });
  }
  if (looks.length > LOOK_COUNT) {
    looks = looks.slice(0, LOOK_COUNT);
  }

  if (engine === "bedrock" && bedrockMeta) {
    // Cost / Log Insights only — never log prompts, context, or catalog.
    console.log(
      JSON.stringify({
        event: "suggest_success",
        suggestionId: suggestionId,
        modelId: bedrockMeta.modelId,
        inputTokens: bedrockMeta.inputTokens,
        outputTokens: bedrockMeta.outputTokens,
        lookCount: looks.length,
      })
    );
  }

  var responseBody = {
    engine: engine,
    context: context,
    looks: looks,
    suggestionId: suggestionId,
  };
  if (bedrockMeta && bedrockMeta.modelId) {
    responseBody.modelId = bedrockMeta.modelId;
  }

  return {
    statusCode: 200,
    body: responseBody,
  };
}

exports.LOOK_COUNT = LOOK_COUNT;
exports.MAX_CONTEXT = MAX_CONTEXT;
exports.MAX_RATIONALE = MAX_RATIONALE;
exports.SLOT_DEFS = SLOT_DEFS;
exports.classifySlot = classifySlot;
exports.assembleRandomLooks = assembleRandomLooks;
exports.assembleWithBedrock = assembleWithBedrock;
exports.serializeCatalogForPrompt = serializeCatalogForPrompt;
exports.systemPrompt = systemPrompt;
exports.validateLookPayload = validateLookPayload;
exports.parseJsonObject = parseJsonObject;
exports.resolveContext = resolveContext;
exports.resolveEngine = resolveEngine;
exports.suggestLooks = suggestLooks;
exports.resetDepsForTests = resetDepsForTests;
exports.DEFAULT_MODEL_ID = DEFAULT_MODEL_ID;
