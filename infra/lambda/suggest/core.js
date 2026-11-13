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
/** Room for 2–4 thoughtful advice sentences after copy sync. */
var MAX_RATIONALE = 560;
var MAX_TITLE = 48;
var MAX_AI_CONTEXT_PROMPT = 300;
/**
 * Soft prompt cap — ~265-item closet with headroom; when exceeded,
 * request-aware formality/role subsetting picks the prompt rows.
 */
var SOFT_CATALOG_CAP = 300;
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
  "- Open knit layering: a cardigan (or similar open knitwear mid-layer) is never the sole top — always include a shirt, tee, polo, or equivalent closed base underneath.",
  "- Black suit + black tie: never pair a black suit (black blazer/suit jacket + black trousers) with a black tie unless the context clearly is a funeral or mourning. For theatre / dress-up / dinner, prefer a coloured or textured tie, or no tie with a dress shirt + blazer.",
  "- Slot uniqueness: at most one base, one bottom, one footwear, and one outer/mid-layer per look — never two shoes or two jackets.",
  "- Cold or outdoor evening / garden / patio: prefer a warm layer (coat, blazer, cardigan, knit overshirt) when the catalog has one.",
  "- Cool outdoor walking (≤~14°C, autumn/fall, chilly city walk / explore outdoors): do not ship a polo, tee, or light shirt alone under a jacket/coat — prefer a warm mid-layer (sweater, turtleneck, fleece, flannel, cardigan over a closed base). Indoor-only / theatre / dress-up looks are exempt.",
  "- Waist finish: looped trousers need a belt, or suspenders/braces when the trousers' aiContext supports them; side-adjuster / beltless trousers are exempt. Prefer belt for casual; suspenders OK when dressy or trousers only support suspenders. Match belt leather tone to footwear (black with black; brown/tan/cognac with brown shoes) — never brown belt with black shoes when a matching belt exists. At most one belt (or one suspenders).",
  "- Honor Frank's session context and each item's aiContext. Diversify the N looks. Closet-only — never invent IDs.",
  "- Multi-day / multi-occasion briefs: one look per named day or occasion when N matches; put that day/occasion in the title and the first rationale sentence. Soft-align formality (board → business; casual train → smart casual).",
  "- Luggage / trip reuse: when packing limits are implied, plan a shared capsule first (≤N unique footwear, trousers, jackets) and reuse across looks.",
  "- Title and rationale must describe only the itemIds in that look (attrs + Wada names) — never name a piece that is not listed. Titles are catchy thematic phrases with personality (fit the look's vibe; occasion need not appear in every title) — ban flat templates like \"Board day blue\", \"blue for Dinner look\", \"black blazer that carries Lunch\", \"Lunch-ready blazer\", \"Quiet gray blazer, Lunch cut\" — never lead with Wada name + brand, never paste session context, never end mid-phrase. Rationales are 2–4 thoughtful sentences (lead with this look's occasion, then materials/palette), varied voice — never reuse the same anchors/Materials stay honest/Palette-wise skeleton every look.",
  "- Name garments in natural wardrobe language: colour + type (fabric when useful); brand/model is secondary (\"black leather jacket (Gipsy)\" / \"black leather Gipsy jacket\"). Never brand-as-noun alone (\"Black Gipsy\", \"Black Hiltl\").",
].join("\n");

/** Core (+ waist) slots that may appear at most once per look. */
var UNIQUE_SLOTS = ["base", "trousers", "footwear", "outer", "belt"];

var FORMALITY_RANK = {
  "black tie": 5,
  formal: 4,
  business: 3,
  "smart casual": 2,
  casual: 1,
  // Seed peers that should rank with casual for subsetting / soft match.
  weekend: 1,
  athletic: 1,
};

var COLD_OUTDOOR_RE =
  /\b(cold|cool|chilly|frosty|freezing|winter|autumn)\b|\bfall\s+(weather|day|evening|morning|air)\b|\bin\s+the\s+fall\b|\bgarden\b|\bpatio\b|\bterrace\b|\boutdoors?\b|\boutside\b|\bevening\b.{0,48}\b(outdoor|outside|garden|patio|terrace)\b|\b(outdoor|outside|garden|patio|terrace)\b.{0,48}\b(evening|night|cold|cool|chilly)\b/i;
/** Outdoor activity cues for cool-weather insulation (city walk / explore). */
var OUTDOOR_ACTIVITY_RE =
  /\b(outdoors?|outside|garden|patio|terrace|city\s*walk|sightseeing|stroll|explore|exploring|walking|walk\s+around|travel\s*day)\b/i;
/** Indoor / dress-up occasions that should not force a warm mid-layer. */
var INDOOR_DRESSUP_RE =
  /\b(theatre|theater|opera|indoor|inside|dress[- ]?up|black[- ]?tie|gala|concert|cinema|museum)\b/i;
/** Thin bases insufficient alone under a coat for cool outdoor walking. */
var THIN_BASE_RE =
  /\b(polo|tee|t-shirt|tshirt)\b|\blight\s+shirt\b|\b(oxford|dress\s+shirt|blouse)\b|\bshirt\b/i;
/** Warm mid-layer / substantial knit bases for cool outdoor insulation. */
var WARM_INSULATION_RE =
  /\b(sweater|jumper|pullover|turtleneck|roll[- ]?neck|fleece|flannel|hoodie|sweatshirt|guernsey|cardigan|cable\s*knit|knit\s*vest)\b/i;
/** Celsius ≤14 or Fahrenheit ≤57 — cool outdoor walking threshold. */
var COOL_CELSIUS_RE = /\b(1[0-4]|[0-9])\s*°\s*c(?:elsius)?\b/i;
var COOL_FAHRENHEIT_RE = /\b(5[0-7]|[1-4][0-9])\s*°\s*f(?:ahrenheit)?\b/i;
/** Open-front knit mid-layers that need a shirt/tee underneath (not a sole top). */
var OPEN_LAYER_KNIT_RE = /\bcardigan\b|\bopen[-\s]?knit\b|\bknit\s+jacket\b/i;
/** Funeral / mourning — only context that allows black suit + black necktie. */
var FUNERAL_MOURNING_RE =
  /\b(funeral|mourning|memorial\s+service|\bwake\b|in\s+memoriam)\b/i;
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

var LOOK_NOUN = "(?:looks?|outfits?|suggestions?|options?|dress(?:es)?)";

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


/**
 * Cardigan / open knit mid-layers — always outer, never the sole "base" top.
 * Closed sweaters/turtlenecks stay base via knitwear role.
 */
function isOpenLayerKnitwear(item) {
  return OPEN_LAYER_KNIT_RE.test(itemRoleTypeText(item));
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

  // Open knit mid-layers layer over a shirt — never classify as base alone.
  if (isOpenLayerKnitwear(item)) return "outer";

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
exports.isOpenLayerKnitwear = isOpenLayerKnitwear;
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
exports.OUTDOOR_ACTIVITY_RE = OUTDOOR_ACTIVITY_RE;
exports.INDOOR_DRESSUP_RE = INDOOR_DRESSUP_RE;
exports.THIN_BASE_RE = THIN_BASE_RE;
exports.WARM_INSULATION_RE = WARM_INSULATION_RE;
exports.COOL_CELSIUS_RE = COOL_CELSIUS_RE;
exports.COOL_FAHRENHEIT_RE = COOL_FAHRENHEIT_RE;
exports.OPEN_LAYER_KNIT_RE = OPEN_LAYER_KNIT_RE;
exports.FUNERAL_MOURNING_RE = FUNERAL_MOURNING_RE;
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
  var text = String(context || "");
  if (!text.trim()) return false;
  if (COLD_OUTDOOR_RE.test(text)) return true;
  if (COOL_CELSIUS_RE.test(text) || COOL_FAHRENHEIT_RE.test(text)) return true;
  return false;
}

function contextHasCoolWeather(context) {
  var text = String(context || "");
  if (!text.trim()) return false;
  if (COOL_CELSIUS_RE.test(text) || COOL_FAHRENHEIT_RE.test(text)) return true;
  if (/\b(cold|chilly|frosty|freezing|winter|autumn)\b/i.test(text)) return true;
  if (/\bfall\s+(weather|day|evening|morning|air)\b|\bin\s+the\s+fall\b/i.test(text)) {
    return true;
  }
  // "cool" alone is weak; require an outdoor / weather neighbour.
  if (
    /\bcool\b/i.test(text) &&
    (OUTDOOR_ACTIVITY_RE.test(text) ||
      /\b(weather|air|evening|morning|day)\b/i.test(text))
  ) {
    return true;
  }
  return false;
}

function contextImpliesOutdoorActivity(text) {
  return OUTDOOR_ACTIVITY_RE.test(String(text || ""));
}

function contextImpliesIndoorDressup(text) {
  var t = String(text || "");
  if (!INDOOR_DRESSUP_RE.test(t)) return false;
  // Outdoor + theatre same sentence still counts outdoor for insulation.
  if (contextImpliesOutdoorActivity(t)) return false;
  return true;
}

/**
 * Thin polo/tee/light shirt — insufficient alone under a coat for cool outdoor walks.
 * Flannel shirts are warm mids, not thin.
 */
function isThinBaseLayer(item) {
  if (!item) return false;
  var roleType = itemRoleTypeText(item);
  if (/\bflannel\b/i.test(roleType) || /\bflannel\b/i.test(String(item.type || ""))) {
    return false;
  }
  if (WARM_INSULATION_RE.test(roleType) && !/\b(polo|tee|t-shirt|tshirt)\b/i.test(roleType)) {
    return false;
  }
  return THIN_BASE_RE.test(roleType);
}

/**
 * Warm mid-layer or substantial knit base (sweater, cardigan, fleece, flannel…).
 * Coats/jackets/blazers alone do not count — need knit/fleece insulation.
 */
function isWarmInsulationPiece(item) {
  if (!item) return false;
  if (isOpenLayerKnitwear(item)) return true;
  var roleType = itemRoleTypeText(item);
  var blob = [roleType, item.type, item.fabric].filter(Boolean).join(" ");
  if (WARM_INSULATION_RE.test(blob)) return true;
  // Closed knitwear role that is not a thin polo/tee.
  if (
    /\bknitwear\b/i.test(String(item.outfitRole || "")) &&
    !/\b(polo|tee|t-shirt|tshirt)\b/i.test(roleType)
  ) {
    return true;
  }
  return false;
}

/** Closed warm base suitable under outerwear (sweater etc. — not open cardigan). */
function isWarmClosedBase(item) {
  return isWarmInsulationPiece(item) && !isOpenLayerKnitwear(item);
}

function contextAllowsBlackSuitBlackTie(context) {
  return FUNERAL_MOURNING_RE.test(String(context || ""));
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
exports.contextHasCoolWeather = contextHasCoolWeather;
exports.contextImpliesOutdoorActivity = contextImpliesOutdoorActivity;
exports.contextImpliesIndoorDressup = contextImpliesIndoorDressup;
exports.isThinBaseLayer = isThinBaseLayer;
exports.isWarmInsulationPiece = isWarmInsulationPiece;
exports.isWarmClosedBase = isWarmClosedBase;
exports.contextAllowsBlackSuitBlackTie = contextAllowsBlackSuitBlackTie;
exports.lookItemIds = lookItemIds;
exports.catalogById = catalogById;
exports.parseJsonObject = parseJsonObject;
exports.itemPrimaryWadaName = itemPrimaryWadaName;
exports.ROLE_MATCH_PRIORITY = ROLE_MATCH_PRIORITY;
