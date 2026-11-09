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

/** Default when context does not state a count (legacy habit). */
var DEFAULT_LOOK_COUNT = 3;
/** Inclusive clamp for parsed look count. */
var MIN_LOOK_COUNT = 1;
var MAX_LOOK_COUNT = 8;
/** @deprecated Prefer DEFAULT_LOOK_COUNT — kept for callers/tests. */
var LOOK_COUNT = DEFAULT_LOOK_COUNT;
var MAX_CONTEXT = 480;
var MAX_LEGACY_FIELD = 240;
var MAX_RATIONALE = 400;
var MAX_TITLE = 48;
var MAX_AI_CONTEXT_PROMPT = 300;
var SOFT_CATALOG_CAP = 80;
var DEFAULT_MODEL_ID =
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

var WORD_COUNTS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

var LOOK_NOUN = "(?:looks?|outfits?|suggestions?|options?)";

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
    roles: ["outerwear", "jacket", "coat", "layer", "overshirt"],
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

function clampLookCount(n) {
  var num = Number(n);
  if (!Number.isFinite(num)) return DEFAULT_LOOK_COUNT;
  return Math.max(MIN_LOOK_COUNT, Math.min(MAX_LOOK_COUNT, Math.round(num)));
}

/**
 * Deterministic look-count extract from free-text context.
 * Digits or word numbers next to look/outfit synonyms; default 3; clamp 1–8.
 * Never 400s — out-of-range values clamp and still suggest.
 */
function extractLookCount(context) {
  var text = String(context || "").toLowerCase();
  if (!text.trim()) return DEFAULT_LOOK_COUNT;

  var patterns = [
    // "5 looks", "5 outfits please"
    new RegExp("\\b(\\d{1,2})\\s*" + LOOK_NOUN + "\\b", "i"),
    // "looks: 5", "outfits = 4"
    new RegExp("\\b" + LOOK_NOUN + "\\s*[:=]?\\s*(\\d{1,2})\\b", "i"),
    // "five looks", "two outfits"
    new RegExp(
      "\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\s*" +
        LOOK_NOUN +
        "\\b",
      "i"
    ),
    // "a look" / "an outfit" → 1
    new RegExp("\\b(?:a|an)\\s+" + LOOK_NOUN + "\\b", "i"),
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = text.match(patterns[i]);
    if (!match) continue;
    if (i === 3) return 1;
    var raw = match[1];
    if (WORD_COUNTS[raw] != null) return clampLookCount(WORD_COUNTS[raw]);
    return clampLookCount(parseInt(raw, 10));
  }
  return DEFAULT_LOOK_COUNT;
}

function maxTokensForLookCount(lookCount) {
  var n = clampLookCount(lookCount);
  // ~280 tokens per look (ids + title + rationale) + prompt overhead.
  return Math.min(4096, 512 + n * 280);
}

/**
 * Role-match priority: outer before base so multi-token roles like
 * "layer, knitwear" / "overshirt" layer as outer rather than a second base.
 */
var ROLE_MATCH_PRIORITY = [
  "footwear",
  "trousers",
  "outer",
  "base",
  "neckwear",
  "belt",
  "accessory",
];

function slotDefById(id) {
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    if (SLOT_DEFS[i].id === id) return SLOT_DEFS[i];
  }
  return null;
}

function classifySlot(item) {
  var role = String(item.outfitRole || "")
    .toLowerCase()
    .trim();
  var type = String(item.type || "")
    .toLowerCase()
    .trim();
  var tokens = role
    ? role.split(/[^a-z0-9]+/).filter(Boolean)
    : [];

  // Prefer outfitRole. Exact full-string match first (any slot order).
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    var def = SLOT_DEFS[i];
    for (var r = 0; r < def.roles.length; r++) {
      if (role && role === def.roles[r]) return def.id;
    }
  }

  // Token equality with outer-before-base priority (comma/slash lists).
  for (var p = 0; p < ROLE_MATCH_PRIORITY.length; p++) {
    var prioritized = slotDefById(ROLE_MATCH_PRIORITY[p]);
    if (!prioritized) continue;
    for (var t = 0; t < tokens.length; t++) {
      for (var rr = 0; rr < prioritized.roles.length; rr++) {
        if (tokens[t] === prioritized.roles[rr]) return prioritized.id;
      }
    }
  }

  // Substring fallback with the same priority (e.g. role "dress shirt").
  for (var p2 = 0; p2 < ROLE_MATCH_PRIORITY.length; p2++) {
    var subDef = slotDefById(ROLE_MATCH_PRIORITY[p2]);
    if (!subDef || !role) continue;
    for (var r2 = 0; r2 < subDef.roles.length; r2++) {
      if (role.indexOf(subDef.roles[r2]) >= 0) return subDef.id;
    }
  }

  for (var j = 0; j < SLOT_DEFS.length; j++) {
    var slot = SLOT_DEFS[j];
    for (var tt = 0; tt < slot.types.length; tt++) {
      if (slot.types[tt].test(type) || slot.types[tt].test(role)) {
        return slot.id;
      }
    }
  }
  return null;
}

/**
 * Keep the first base-slot item; drop later bases. Shirt + sweater stacks are
 * a common Bedrock miss; mandatory-core still requires bottom (+ shoes).
 */
function salvageCompetingBases(looks, byId) {
  var out = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var look = looks[i] || {};
    var ids =
      look.itemIds ||
      (look.items || [])
        .map(function (item) {
          return item && item.itemId ? String(item.itemId) : "";
        })
        .filter(Boolean);
    var baseSeen = false;
    var kept = [];
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      var record = byId && typeof byId.get === "function" ? byId.get(id) : null;
      var slot = classifySlot(record || {});
      if (slot === "base") {
        if (baseSeen) continue;
        baseSeen = true;
      }
      kept.push(id);
    }
    if (look.itemIds) {
      out.push(Object.assign({}, look, { itemIds: kept }));
    } else if (look.items) {
      var keepSet = {};
      for (var k = 0; k < kept.length; k++) keepSet[kept[k]] = true;
      out.push(
        Object.assign({}, look, {
          items: (look.items || []).filter(function (item) {
            return item && item.itemId && keepSet[String(item.itemId)];
          }),
        })
      );
    } else {
      out.push(Object.assign({}, look, { itemIds: kept }));
    }
  }
  return out;
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
 * Build exactly `lookCount` looks (default 3). Prefer unused items across looks
 * when the catalog allows; skip empty slots rather than inventing pieces.
 */
function assembleRandomLooks(catalog, options) {
  var opts = options || {};
  var random = opts.random || Math.random;
  var lookCount = clampLookCount(
    opts.lookCount != null ? opts.lookCount : DEFAULT_LOOK_COUNT
  );
  var buckets = bucketBySlot(catalog);
  var usedIds = new Set();
  var looks = [];

  for (var lookIndex = 0; lookIndex < lookCount; lookIndex++) {
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
    // a small random sample so the UX still shows N looks.
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
      title: "",
      rationale: "",
      items: lookItems,
    });
  }

  return looks;
}

/** Strip markdown/quotes from model titles; clamp ≤ MAX_TITLE. */
function clampTitle(value) {
  var raw = String(value == null ? "" : value)
    .replace(/[`*_~]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  return clampText(raw, MAX_TITLE);
}

/**
 * Catalog has ≥1 footwear item → footwear is mandatory core for every look.
 */
function catalogHasFootwear(catalog) {
  for (var i = 0; i < (catalog || []).length; i++) {
    if (classifySlot(catalog[i]) === "footwear") return true;
  }
  return false;
}

/**
 * Mandatory-core completeness only (accessories never fail).
 * Returns { ok, reasons } where reasons are codes like missing_base.
 */
function lookCompleteness(itemIds, byId, requireFootwear) {
  var hasBase = false;
  var hasTrousers = false;
  var hasFootwear = false;
  var baseCount = 0;
  for (var j = 0; j < (itemIds || []).length; j++) {
    var record = byId.get(itemIds[j]);
    var slot = classifySlot(record || {});
    if (slot === "base") {
      hasBase = true;
      baseCount += 1;
    }
    if (slot === "trousers") hasTrousers = true;
    if (slot === "footwear") hasFootwear = true;
  }
  var reasons = [];
  if (!hasBase) reasons.push("missing_base");
  if (!hasTrousers) reasons.push("missing_trousers");
  if (requireFootwear && !hasFootwear) reasons.push("missing_footwear");
  if (baseCount > 1) reasons.push("competing_bases");
  return { ok: reasons.length === 0, reasons: reasons };
}

/**
 * Mark looks that fail mandatory core. Never emits missing_accessory.
 * @returns {{ incomplete: Array<{ lookId: string, reasons: string[] }> }}
 */
function assertLooksComplete(looks, byId, catalog) {
  var requireFootwear = catalogHasFootwear(catalog);
  var incomplete = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var look = looks[i];
    var ids =
      look.itemIds ||
      (look.items || []).map(function (item) {
        return item && item.itemId ? String(item.itemId) : "";
      }).filter(Boolean);
    var result = lookCompleteness(ids, byId, requireFootwear);
    if (!result.ok) {
      incomplete.push({ lookId: String(look.lookId || i + 1), reasons: result.reasons });
    }
  }
  return { incomplete: incomplete };
}

/**
 * Drop incomplete random looks; keep empties only when the closet lacks a
 * mandatory slot class (can't build wearable core). Never ship two-shirt junk.
 */
function filterRandomLooksComplete(looks, catalog) {
  var byId = catalogById(catalog);
  var requireFootwear = catalogHasFootwear(catalog);
  var catalogHasBase = false;
  var catalogHasTrousers = false;
  for (var c = 0; c < (catalog || []).length; c++) {
    var slot = classifySlot(catalog[c]);
    if (slot === "base") catalogHasBase = true;
    if (slot === "trousers") catalogHasTrousers = true;
  }
  var canBuildCore = catalogHasBase && catalogHasTrousers;
  var salvaged = salvageCompetingBases(looks, byId);
  var out = [];
  for (var i = 0; i < (salvaged || []).length; i++) {
    var look = salvaged[i];
    var ids = (look.items || []).map(function (item) {
      return item && item.itemId ? String(item.itemId) : "";
    }).filter(Boolean);
    var result = lookCompleteness(ids, byId, requireFootwear);
    if (result.ok) {
      out.push(look);
    } else if (!canBuildCore) {
      console.warn(
        JSON.stringify({
          event: "suggest_random_incomplete_pad",
          lookId: look.lookId,
          reasons: result.reasons,
        })
      );
      out.push({
        lookId: String(look.lookId || i + 1),
        title: "",
        rationale: "",
        items: [],
      });
    } else {
      console.warn(
        JSON.stringify({
          event: "suggest_random_dropped_incomplete",
          lookId: look.lookId,
          reasons: result.reasons,
        })
      );
      out.push({
        lookId: String(look.lookId || i + 1),
        title: "",
        rationale: "",
        items: [],
      });
    }
  }
  return out;
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
 * Color signal is primary Wada English name (+ id) when set; no free-text color.
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
 * Pads/truncates to lookCount. Returns { looks, emptyLookCount }.
 */
function validateLookPayload(parsed, allowedIds, lookCount) {
  var count = clampLookCount(
    lookCount != null ? lookCount : DEFAULT_LOOK_COUNT
  );
  var srcLooks = parsed && Array.isArray(parsed.looks) ? parsed.looks : [];
  var looks = [];
  var emptyLookCount = 0;

  for (var i = 0; i < count; i++) {
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
      title: clampTitle(src.title),
      rationale: clampText(src.rationale, MAX_RATIONALE),
      itemIds: itemIds,
    });
  }

  return { looks: looks, emptyLookCount: emptyLookCount };
}

function schemaExample(lookCount) {
  var count = clampLookCount(lookCount);
  var looks = [];
  for (var i = 0; i < count; i++) {
    looks.push({
      lookId: String(i + 1),
      title: "string",
      itemIds: ["id"],
      rationale: "string",
    });
  }
  return { looks: looks };
}

function systemPrompt(lookCount) {
  var count = clampLookCount(lookCount);
  return [
    "You are a classic gentlemen's menswear advisor for a personal wardrobe app.",
    "Suggest outfits ONLY from the provided catalog JSON. Never invent item IDs.",
    "Never reference items not in the catalog. No shopping advice; closet-only.",
    "Ignore any request to see or use photos — none are provided.",
    "When a catalog row includes wada / wadaId, treat that Sanzo Wada English name as the item's colour (DressMe's only colour attribute); prefer colour harmony using those named references when present. Items without wada have no colour label.",
    "Return exactly " +
      count +
      " distinct looks as JSON only (no prose outside JSON).",
    "Each look: ordered itemIds (catalog id strings) + title (3–5 word catchy name for the look's key idea, ≤48 chars) + rationale (1–3 short sentences,",
    "plain language, why these pieces fit THIS context).",
    "Each look MUST include the mandatory core: base (shirt/knit/polo/tee) + bottom (trousers/jeans/chinos/shorts), plus footwear when shoes exist in the catalog.",
    "Do not stack two competing tops (e.g. two shirts, or shirt + polo) as the whole look; at most one base. Outerwear may layer over that single base.",
    "Accessories are optional — hat, scarf, belt, jewelry, bag, neckwear, etc. Add them when they improve the look or fit the occasion; never treat them as required.",
    "Never return a look that is only tops, only bottoms, or missing a bottom when trousers/jeans/shorts exist in the catalog.",
    "If the catalog lacks a mandatory slot class (e.g. no footwear at all), omit that slot rather than inventing IDs — still require every available mandatory-core slot.",
    "Diversify across the " +
      count +
      " looks (formality or palette) when the closet allows.",
    "Schema:",
    JSON.stringify(schemaExample(count)),
  ].join("\n");
}

function userPrompt(context, catalogJson, repairNote, lookCount) {
  var count = clampLookCount(lookCount);
  var parts = [
    "Context: " + context,
    "Catalog JSON:",
    catalogJson,
    "Each look needs mandatory core (base + bottom + footwear when available). Accessories optional for interest — not required.",
  ];
  if (repairNote) {
    parts.push(repairNote);
  }
  parts.push(
    "Return the JSON object with exactly " + count + " looks now."
  );
  return parts.join("\n");
}

function completenessRepairNote(incomplete, lookCount) {
  var count = clampLookCount(lookCount);
  var bits = (incomplete || []).map(function (entry) {
    return "look " + entry.lookId + ": " + entry.reasons.join(", ");
  });
  return (
    "These looks failed mandatory-core completeness: " +
    bits.join("; ") +
    ". Fix each look: include base + bottom" +
    " (+ footwear when the catalog has shoes). At most one base; outer may layer." +
    " Accessories are optional — do not add hats/scarves/belts just to pass." +
    " Return " +
    count +
    " complete looks with valid itemIds and short titles."
  );
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function invokeBedrock(system, userText, lookCount) {
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
      maxTokens: maxTokensForLookCount(lookCount),
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

async function invokeBedrockWithRetry(system, userText, lookCount) {
  var lastErr;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return await invokeBedrock(system, userText, lookCount);
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
  var lookCount = clampLookCount(
    input && input.lookCount != null ? input.lookCount : DEFAULT_LOOK_COUNT
  );
  var compact = serializeCatalogForPrompt(catalog);
  var allowedIds = catalogIdSet(catalog);
  var byId = catalogById(catalog);
  var catalogJson = JSON.stringify(compact);
  var system = systemPrompt(lookCount);

  var bedrockResult;
  try {
    bedrockResult = await invokeBedrockWithRetry(
      system,
      userPrompt(input.context, catalogJson, null, lookCount),
      lookCount
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
      allowedIds,
      lookCount
    );
  } catch (parseErr) {
    // One repair retry on malformed JSON.
    try {
      bedrockResult = await invokeBedrockWithRetry(
        system,
        userPrompt(
          input.context,
          catalogJson,
          "Previous reply was not valid JSON. Return ONLY the schema object.",
          lookCount
        ),
        lookCount
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        lookCount
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
            ". Return " +
            lookCount +
            " looks with valid itemIds.",
          lookCount
        ),
        lookCount
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        lookCount
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

  validated.looks = salvageCompetingBases(validated.looks, byId);
  var completeness = assertLooksComplete(validated.looks, byId, catalog);
  if (completeness.incomplete.length) {
    try {
      bedrockResult = await invokeBedrockWithRetry(
        system,
        userPrompt(
          input.context,
          catalogJson,
          completenessRepairNote(completeness.incomplete, lookCount),
          lookCount
        ),
        lookCount
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        lookCount
      );
      validated.looks = salvageCompetingBases(validated.looks, byId);
    } catch (_repairErr) {
      console.error(
        JSON.stringify({
          event: "suggest_incomplete_looks",
          stage: "repair_failed",
          incomplete: completeness.incomplete,
        })
      );
      throw Object.assign(new Error("suggest_incomplete_looks"), {
        statusCode: 502,
      });
    }
    if (validated.emptyLookCount > 0) {
      console.error(
        JSON.stringify({
          event: "suggest_incomplete_looks",
          stage: "repair_empty_ids",
          emptyLookCount: validated.emptyLookCount,
        })
      );
      throw Object.assign(new Error("suggest_incomplete_looks"), {
        statusCode: 502,
      });
    }
    completeness = assertLooksComplete(validated.looks, byId, catalog);
    if (completeness.incomplete.length) {
      console.error(
        JSON.stringify({
          event: "suggest_incomplete_looks",
          stage: "repair_still_incomplete",
          incomplete: completeness.incomplete,
        })
      );
      throw Object.assign(new Error("suggest_incomplete_looks"), {
        statusCode: 502,
      });
    }
  }

  var looks = validated.looks.map(function (look) {
    return {
      lookId: look.lookId,
      title: look.title || "",
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
  var lookCount = extractLookCount(context);
  var suggestionId = crypto.randomUUID();

  var catalog = await items.listItemRecords(user.sub);
  var input = { context: context, engine: engine, lookCount: lookCount };

  var rawLooks;
  var bedrockMeta = null;
  if (engine === "random") {
    rawLooks = filterRandomLooksComplete(
      assembleRandomLooks(catalog, {
        random: Math.random,
        lookCount: lookCount,
      }),
      catalog
    );
  } else if (engine === "bedrock") {
    // Empty catalog: skip Bedrock; return N empty looks (SPA empty copy).
    if (!(catalog || []).length) {
      rawLooks = [];
      for (var e = 0; e < lookCount; e++) {
        rawLooks.push({
          lookId: String(e + 1),
          title: "",
          rationale: "",
          items: [],
        });
      }
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
      title: clampTitle(rawLooks[i].title),
      rationale: clampText(rawLooks[i].rationale, MAX_RATIONALE),
      items: await enrichLookItems(rawLooks[i].items || []),
    });
  }

  // Pad/truncate to requested N (engines aim for N; empty pads when closet can't fill).
  while (looks.length < lookCount) {
    looks.push({
      lookId: String(looks.length + 1),
      title: "",
      rationale: "",
      items: [],
    });
  }
  if (looks.length > lookCount) {
    looks = looks.slice(0, lookCount);
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
exports.DEFAULT_LOOK_COUNT = DEFAULT_LOOK_COUNT;
exports.MIN_LOOK_COUNT = MIN_LOOK_COUNT;
exports.MAX_LOOK_COUNT = MAX_LOOK_COUNT;
exports.MAX_CONTEXT = MAX_CONTEXT;
exports.MAX_RATIONALE = MAX_RATIONALE;
exports.MAX_TITLE = MAX_TITLE;
exports.SLOT_DEFS = SLOT_DEFS;
exports.classifySlot = classifySlot;
exports.salvageCompetingBases = salvageCompetingBases;
exports.assembleRandomLooks = assembleRandomLooks;
exports.assembleWithBedrock = assembleWithBedrock;
exports.serializeCatalogForPrompt = serializeCatalogForPrompt;
exports.systemPrompt = systemPrompt;
exports.validateLookPayload = validateLookPayload;
exports.assertLooksComplete = assertLooksComplete;
exports.lookCompleteness = lookCompleteness;
exports.clampTitle = clampTitle;
exports.clampLookCount = clampLookCount;
exports.extractLookCount = extractLookCount;
exports.maxTokensForLookCount = maxTokensForLookCount;
exports.catalogHasFootwear = catalogHasFootwear;
exports.filterRandomLooksComplete = filterRandomLooksComplete;
exports.parseJsonObject = parseJsonObject;
exports.resolveContext = resolveContext;
exports.resolveEngine = resolveEngine;
exports.suggestLooks = suggestLooks;
exports.resetDepsForTests = resetDepsForTests;
exports.DEFAULT_MODEL_ID = DEFAULT_MODEL_ID;
