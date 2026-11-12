"use strict";

var crypto = require("crypto");
var {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
var wadaPalette = require("../wadaPalette");
var wadaSoftCombos = require("../wadaSoftCombos.v1.json");

/** Default when context does not state a count (legacy habit). */
var DEFAULT_LOOK_COUNT = 3;
/** Inclusive clamp for parsed look count. */
var MIN_LOOK_COUNT = 1;
var MAX_LOOK_COUNT = 8;
/** @deprecated Prefer DEFAULT_LOOK_COUNT — kept for callers/tests. */
var LOOK_COUNT = DEFAULT_LOOK_COUNT;
var MAX_CONTEXT = 480;
var MAX_LEGACY_FIELD = 240;
/** Room for 2–4 thoughtful advice sentences after copy sync. */
var MAX_RATIONALE = 560;
var MAX_TITLE = 48;
var MAX_AI_CONTEXT_PROMPT = 300;
/** Soft prompt cap — prefer role/formality rows when closet exceeds this. */
var SOFT_CATALOG_CAP = 120;
/**
 * Skip optional Bedrock repair/fill if the primary call already burned most of
 * the CloudFront origin_read_timeout budget (60s without quota). Keeps the
 * response under the edge timeout even when Sonnet + N looks is slow.
 */
var SECOND_PASS_DEADLINE_MS = 40000;
/** Analyze default; Suggest prefers SUGGEST_MODEL_ID when set. */
var DEFAULT_MODEL_ID =
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * DressMe style pack (v1) — token-cheap classic menswear rules for Suggest.
 * Durable taste stays in catalog attrs/aiContext + session context.
 */
var STYLE_PACK_V1 = [
  "DressMe style pack v1:",
  "- Classic menswear: match occasion formality; keep shoe–trouser relationships coherent; avoid costume stacking.",
  "- Function: fabrics/weights vs weather — open-weave/linen lose in cold; waxed/wool suit damp evening outdoors.",
  "- Completeness: every look needs base + bottom (+ footwear when shoes exist). Accessories when context warrants.",
  "- Slot uniqueness: at most one base, one bottom, one footwear, and one outer/mid-layer per look — never two shoes or two jackets.",
  "- Cold or outdoor evening / garden / patio: prefer a warm layer (coat, blazer, cardigan, knit overshirt) when the catalog has one.",
  "- Waist finish: looped trousers need a belt, or suspenders/braces when the trousers' aiContext supports them; side-adjuster / beltless trousers are exempt. Prefer belt for casual; suspenders OK when dressy or trousers only support suspenders. Match belt leather tone to footwear (black with black; brown/tan/cognac with brown shoes) — never brown belt with black shoes when a matching belt exists. At most one belt (or one suspenders).",
  "- Honor Frank's session context and each item's aiContext. Diversify the N looks. Closet-only — never invent IDs.",
  "- Multi-day / multi-occasion briefs: one look per named day or occasion when N matches; put that day/occasion in the title and the first rationale sentence. Soft-align formality (board → business; casual train → smart casual).",
  "- Luggage / trip reuse: when packing limits are implied, plan a shared capsule first (≤N unique footwear, trousers, jackets) and reuse across looks.",
  "- Title and rationale must describe only the itemIds in that look (attrs + Wada names) — never name a piece that is not listed. Titles are catchy occasion-led phrases — never lead with Wada name + brand, never paste session context, never end mid-phrase. Rationales are 2–4 thoughtful sentences (lead with this look's occasion, then materials/palette), varied voice — never reuse the same anchors/Materials stay honest/Palette-wise skeleton every look.",
].join("\n");

/** Core (+ waist) slots that may appear at most once per look. */
var UNIQUE_SLOTS = ["base", "trousers", "footwear", "outer", "belt"];

var FORMALITY_RANK = {
  "black tie": 5,
  formal: 4,
  business: 3,
  "smart casual": 2,
  casual: 1,
};

var COLD_OUTDOOR_RE =
  /\b(cold|cool|chilly|frosty|freezing|winter)\b|\bgarden\b|\bpatio\b|\bterrace\b|\boutdoors?\b|\boutside\b|\bevening\b.{0,48}\b(outdoor|outside|garden|patio|terrace)\b|\b(outdoor|outside|garden|patio|terrace)\b.{0,48}\b(evening|night|cold|cool|chilly)\b/i;
var SIDE_ADJUSTER_RE =
  /side[-\s]?adjusters?|side[-\s]?tabs?|\bno\s+belt\b|beltless/i;
var SUSPENDER_CAPABLE_RE =
  /suspenders?|\bbraces\b|suspender\s+buttons?|buttons?\s+for\s+suspenders?/i;
var BELT_ITEM_RE = /\bbelt\b/i;
var SUSPENDERS_ITEM_RE = /suspenders?|\bbraces\b/i;
var TRIP_LUGGAGE_RE =
  /\b(trip|travel(?:ing|ling)?|luggage|suitcase|carry[- ]?on|packing|packed)\b/i;
var DEFAULT_PACKING_LIMIT = 2;
var COLOR_WORD_RE =
  /\b(navy|blue|grey|gray|green|black|brown|white|cream|beige|tan|olive|burgundy|charcoal|slate|cognac|wine|red|khaki)\b/i;
/** Classic menswear leather-tone buckets for belt ↔ shoe matching. */
var LEATHER_TONE_FAMILIES = {
  black: "black",
  charcoal: "black",
  slate: "black",
  grey: "black",
  gray: "black",
  brown: "brown",
  tan: "brown",
  cognac: "brown",
  beige: "brown",
  khaki: "brown",
  cream: "brown",
  olive: "brown",
  burgundy: "burgundy",
  wine: "burgundy",
  red: "burgundy",
  navy: "navy",
  blue: "navy",
};
var BROKEN_COPY_RE =
  /\bI would(?: like)?\b|\bcreate for me\b|\btraveling next wee\b/i;
/** Deterministic template fingerprints — Bedrock rewrite should beat these. */
var FORMULAIC_COPY_RES = [
  /anchors the look/i,
  /Materials stay honest/i,
  /Palette-wise,/i,
  /keep the true-color story tidy/i,
  /Primary Wada /i,
  /Shoe–trouser formality and the base layer stay aligned/i,
];

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
    label: "belt / waist finish",
    roles: ["belt", "suspenders", "braces"],
    types: [/\bbelt\b/, /suspenders?/, /\bbraces\b/],
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
  now: null,
};

function resetDepsForTests(next) {
  deps.bedrock = next && next.bedrock ? next.bedrock : null;
  deps.converse = next && typeof next.converse === "function" ? next.converse : null;
  deps.now = next && typeof next.now === "function" ? next.now : null;
}

function nowMs() {
  return deps.now ? deps.now() : Date.now();
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
  // Suggest may trial a stronger model via SUGGEST_MODEL_ID; Analyze stays on BEDROCK_MODEL_ID.
  return (
    String(
      process.env.SUGGEST_MODEL_ID ||
        process.env.BEDROCK_MODEL_ID ||
        DEFAULT_MODEL_ID
    ).trim() || DEFAULT_MODEL_ID
  );
}

function itemSearchText(item) {
  var row = item || {};
  return [row.outfitRole, row.type, row.aiContext, row.brandModel, row.fabric]
    .filter(Boolean)
    .join(" ");
}

function itemRoleTypeText(item) {
  var row = item || {};
  // Role/type only — aiContext may say "belt loops" on trousers without being a belt.
  return [row.outfitRole, row.type].filter(Boolean).join(" ");
}

function slotDefById(id) {
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    if (SLOT_DEFS[i].id === id) return SLOT_DEFS[i];
  }
  return null;
}

var ROLE_MATCH_PRIORITY = [
  "footwear",
  "trousers",
  "outer",
  "base",
  "neckwear",
  "belt",
  "accessory",
];


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

function formalityRank(value) {
  // Closet may store seed "black-tie" or typed "black tie" — fold hyphens/underscores.
  var key = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return 0;
  if (FORMALITY_RANK[key] != null) return FORMALITY_RANK[key];
  if (key.indexOf("black tie") >= 0 || key.indexOf("blacktie") >= 0) return 5;
  if (key.indexOf("formal") >= 0) return 4;
  if (key.indexOf("business") >= 0) return 3;
  if (key.indexOf("smart") >= 0) return 2;
  if (key.indexOf("casual") >= 0) return 1;
  return 0;
}

function lookTargetFormality(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record =
      byId && typeof byId.get === "function" ? byId.get(ids[i]) : null;
    if (classifySlot(record || {}) === "footwear") {
      return formalityRank(record && record.formality);
    }
  }
  var best = 0;
  for (var j = 0; j < (ids || []).length; j++) {
    var row =
      byId && typeof byId.get === "function" ? byId.get(ids[j]) : null;
    best = Math.max(best, formalityRank(row && row.formality));
  }
  return best;
}

function isUniqueSlot(slot) {
  return UNIQUE_SLOTS.indexOf(slot) >= 0;
}

/**
 * Keep at most one item per unique slot (base, bottom, footwear, outer, belt).
 * Prefer higher formality match to the look's footwear (else first). Never ship
 * two shoes / two jackets / two belts.
 */

exports.DEFAULT_LOOK_COUNT = DEFAULT_LOOK_COUNT;
exports.MIN_LOOK_COUNT = MIN_LOOK_COUNT;
exports.MAX_LOOK_COUNT = MAX_LOOK_COUNT;
exports.LOOK_COUNT = LOOK_COUNT;
exports.MAX_CONTEXT = MAX_CONTEXT;
exports.MAX_LEGACY_FIELD = MAX_LEGACY_FIELD;
exports.MAX_RATIONALE = MAX_RATIONALE;
exports.MAX_TITLE = MAX_TITLE;
exports.MAX_AI_CONTEXT_PROMPT = MAX_AI_CONTEXT_PROMPT;
exports.SOFT_CATALOG_CAP = SOFT_CATALOG_CAP;
exports.SECOND_PASS_DEADLINE_MS = SECOND_PASS_DEADLINE_MS;
exports.DEFAULT_MODEL_ID = DEFAULT_MODEL_ID;
exports.STYLE_PACK_V1 = STYLE_PACK_V1;
exports.UNIQUE_SLOTS = UNIQUE_SLOTS;
exports.FORMALITY_RANK = FORMALITY_RANK;
exports.SLOT_DEFS = SLOT_DEFS;
exports.deps = deps;
exports.resetDepsForTests = resetDepsForTests;
exports.bedrockClient = bedrockClient;
exports.classifySlot = classifySlot;
exports.formalityRank = formalityRank;
exports.isUniqueSlot = isUniqueSlot;
exports.itemRoleTypeText = itemRoleTypeText;
exports.itemSearchText = itemSearchText;
exports.lookTargetFormality = lookTargetFormality;
exports.modelId = modelId;
exports.nowMs = nowMs;
exports.resetDepsForTests = resetDepsForTests;
exports.slotDefById = slotDefById;
exports.WORD_COUNTS = WORD_COUNTS;
exports.LOOK_NOUN = LOOK_NOUN;
exports.COLD_OUTDOOR_RE = COLD_OUTDOOR_RE;
exports.SIDE_ADJUSTER_RE = SIDE_ADJUSTER_RE;
exports.SUSPENDER_CAPABLE_RE = SUSPENDER_CAPABLE_RE;
exports.BELT_ITEM_RE = BELT_ITEM_RE;
exports.SUSPENDERS_ITEM_RE = SUSPENDERS_ITEM_RE;
exports.TRIP_LUGGAGE_RE = TRIP_LUGGAGE_RE;
exports.DEFAULT_PACKING_LIMIT = DEFAULT_PACKING_LIMIT;
exports.COLOR_WORD_RE = COLOR_WORD_RE;
exports.LEATHER_TONE_FAMILIES = LEATHER_TONE_FAMILIES;
exports.BROKEN_COPY_RE = BROKEN_COPY_RE;
function contextNeedsColdLayer(context) {
  return COLD_OUTDOOR_RE.test(String(context || ""));
}


function lookItemIds(look) {
  if (look && Array.isArray(look.itemIds)) {
    return look.itemIds.map(String).filter(Boolean);
  }
  return ((look && look.items) || [])
    .map(function (row) {
      return row && row.itemId ? String(row.itemId) : "";
    })
    .filter(Boolean);
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


function itemPrimaryWadaName(item) {
  var ids = item && Array.isArray(item.wadaColorIds) ? item.wadaColorIds : [];
  if (!ids.length) return "";
  var resolved = wadaPalette.resolveWadaColor(String(ids[0] || ""));
  return resolved && resolved.name ? String(resolved.name) : "";
}


exports.FORMULAIC_COPY_RES = FORMULAIC_COPY_RES;
exports.contextNeedsColdLayer = contextNeedsColdLayer;
exports.lookItemIds = lookItemIds;
exports.catalogById = catalogById;
exports.parseJsonObject = parseJsonObject;
exports.itemPrimaryWadaName = itemPrimaryWadaName;
exports.ROLE_MATCH_PRIORITY = ROLE_MATCH_PRIORITY;
