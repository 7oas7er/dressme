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
var wadaSoftCombos = require("./wadaSoftCombos.v1.json");

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
var SOFT_CATALOG_CAP = 80;
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
  "- Waist finish: looped trousers need a belt, or suspenders/braces when the trousers' aiContext supports them; side-adjuster / beltless trousers are exempt. Prefer belt for casual; suspenders OK when dressy or trousers only support suspenders. Match belt to footwear when using a belt. At most one belt (or one suspenders).",
  "- Honor Frank's session context and each item's aiContext. Diversify the N looks. Closet-only — never invent IDs.",
  "- Title and rationale must describe only the itemIds in that look (attrs + Wada names) — never name a piece that is not listed. Titles stay catchy but full; rationales are 2–4 thoughtful sentences (occasion/weather, materials, palette), not telegraphic one-liners.",
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

function contextNeedsColdLayer(context) {
  return COLD_OUTDOOR_RE.test(String(context || ""));
}

function catalogHasSlot(catalog, slotId) {
  for (var i = 0; i < (catalog || []).length; i++) {
    if (classifySlot(catalog[i]) === slotId) return true;
  }
  return false;
}

function itemRoleTypeText(item) {
  var row = item || {};
  // Role/type only — aiContext may say "belt loops" on trousers without being a belt.
  return [row.outfitRole, row.type].filter(Boolean).join(" ");
}

function isBeltItem(item) {
  var roleType = itemRoleTypeText(item);
  if (SUSPENDERS_ITEM_RE.test(roleType) && !BELT_ITEM_RE.test(roleType)) {
    return false;
  }
  if (classifySlot(item || {}) === "belt") {
    return !SUSPENDERS_ITEM_RE.test(roleType) || BELT_ITEM_RE.test(roleType);
  }
  return BELT_ITEM_RE.test(roleType);
}

function isSuspendersItem(item) {
  return SUSPENDERS_ITEM_RE.test(itemRoleTypeText(item));
}

function trousersNeedWaistFinish(item) {
  if (classifySlot(item || {}) !== "trousers") return false;
  return !SIDE_ADJUSTER_RE.test(itemSearchText(item));
}

function trousersSuspenderCapable(item) {
  return SUSPENDER_CAPABLE_RE.test(itemSearchText(item));
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

function lookHasOuterLayer(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (classifySlot(record || {}) === "outer") return true;
  }
  return false;
}

function lookHasWaistFinish(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (!record) continue;
    if (isBeltItem(record) || isSuspendersItem(record)) return true;
  }
  return false;
}

function findLookTrousers(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (classifySlot(record || {}) === "trousers") return record;
  }
  return null;
}

function catalogHasBelt(catalog) {
  for (var i = 0; i < (catalog || []).length; i++) {
    if (isBeltItem(catalog[i])) return true;
  }
  return false;
}

function catalogHasSuspenders(catalog) {
  for (var i = 0; i < (catalog || []).length; i++) {
    if (isSuspendersItem(catalog[i])) return true;
  }
  return false;
}

function softWadaPriorText() {
  var combos =
    (wadaSoftCombos && wadaSoftCombos.combinations) || [];
  if (!combos.length) return "";
  var lines = combos.map(function (row) {
    return (
      "#" +
      row.id +
      ": " +
      (row.names || []).join(" / ")
    );
  });
  return [
    "Soft Sanzo Wada combination prior (published Vol.1 plates; MIT vendor data):",
    "Prefer colour harmony inspired by these when piece primaries roughly fit.",
    "Never reject a look solely for missing a book combination.",
    lines.join("; "),
  ].join("\n");
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

function formalityRank(value) {
  var key = String(value || "")
    .toLowerCase()
    .trim();
  if (!key) return 0;
  if (FORMALITY_RANK[key] != null) return FORMALITY_RANK[key];
  if (key.indexOf("black tie") >= 0) return 5;
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
function enforceSlotUniqueness(looks, byId) {
  var out = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var look = looks[i] || {};
    var ids = lookItemIds(look);
    var targetFormality = lookTargetFormality(ids, byId);
    var bestBySlot = {};
    var order = [];
    var dropped = [];

    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      var record =
        byId && typeof byId.get === "function" ? byId.get(id) : null;
      var slot = classifySlot(record || {});
      if (!isUniqueSlot(slot)) {
        order.push(id);
        continue;
      }
      var score = formalityRank(record && record.formality);
      var match =
        targetFormality > 0 ? -Math.abs(score - targetFormality) : -j;
      var prev = bestBySlot[slot];
      if (!prev) {
        bestBySlot[slot] = { id: id, match: match, index: j };
        continue;
      }
      if (
        match > prev.match ||
        (match === prev.match && j < prev.index)
      ) {
        dropped.push(prev.id);
        bestBySlot[slot] = { id: id, match: match, index: j };
      } else {
        dropped.push(id);
      }
    }

    var keepSet = {};
    for (var s = 0; s < UNIQUE_SLOTS.length; s++) {
      var pick = bestBySlot[UNIQUE_SLOTS[s]];
      if (pick) keepSet[pick.id] = true;
    }
    for (var o = 0; o < order.length; o++) keepSet[order[o]] = true;

    var kept = [];
    for (var k = 0; k < ids.length; k++) {
      if (keepSet[ids[k]] && kept.indexOf(ids[k]) < 0) kept.push(ids[k]);
    }
    if (dropped.length) {
      console.warn(
        JSON.stringify({
          event: "suggest_slot_dedupe",
          lookId: look.lookId,
          dropped: dropped,
        })
      );
    }

    if (look.itemIds) {
      out.push(Object.assign({}, look, { itemIds: kept }));
    } else if (look.items) {
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

/** @deprecated Prefer enforceSlotUniqueness — kept for callers/tests. */
function salvageCompetingBases(looks, byId) {
  return enforceSlotUniqueness(looks, byId);
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

function sameIdList(a, b) {
  var left = (a || []).map(String);
  var right = (b || []).map(String);
  if (left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function itemPrimaryWadaName(item) {
  var ids = item && Array.isArray(item.wadaColorIds) ? item.wadaColorIds : [];
  if (!ids.length) return "";
  var resolved = wadaPalette.resolveWadaColor(String(ids[0] || ""));
  return resolved && resolved.name ? String(resolved.name) : "";
}

function itemLabel(item) {
  var row = item || {};
  var wada = itemPrimaryWadaName(row);
  var brand = String(row.brandModel || "").trim();
  var type = String(row.type || row.outfitRole || "piece").trim();
  if (brand && type && brand.toLowerCase() !== type.toLowerCase()) {
    return (wada ? wada + " " : "") + brand;
  }
  if (wada && type) return wada + " " + type;
  return brand || type || "piece";
}

function significantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s/-]+/)
    .filter(function (tok) {
      return (
        tok.length >= 4 &&
        [
          "with",
          "from",
          "this",
          "that",
          "look",
          "pair",
          "pairs",
          "piece",
          "pieces",
          "outfit",
          "classic",
          "navy", // too common alone; still caught via full phrases below
        ].indexOf(tok) < 0
      );
    });
}

function itemMentionTokens(item) {
  var row = item || {};
  var bits = [
    row.brandModel,
    row.type,
    row.outfitRole,
    itemPrimaryWadaName(row),
  ];
  var out = [];
  var seen = {};
  for (var i = 0; i < bits.length; i++) {
    var tokens = significantTokens(bits[i]);
    for (var t = 0; t < tokens.length; t++) {
      if (seen[tokens[t]]) continue;
      seen[tokens[t]] = true;
      out.push(tokens[t]);
    }
  }
  // Multi-word brand/type phrases (e.g. "leather jacket", "cardigan").
  var phrases = [row.brandModel, row.type]
    .map(function (v) {
      return String(v || "")
        .toLowerCase()
        .trim();
    })
    .filter(function (v) {
      return v.length >= 5;
    });
  return { tokens: out, phrases: phrases };
}

/**
 * True when title/rationale names catalog pieces (or their distinctive labels)
 * that are not in the final look — classic cardigan-copy / jacket-photo miss.
 */
function copyMentionsForeignPieces(title, rationale, finalIds, byId, catalog) {
  var finalSet = {};
  for (var i = 0; i < (finalIds || []).length; i++) {
    finalSet[String(finalIds[i])] = true;
  }
  var copy = String(title || "") + " " + String(rationale || "");
  var lower = copy.toLowerCase();
  if (!lower.trim()) return false;

  // Explicit catalog IDs in copy that are not final.
  for (var c = 0; c < (catalog || []).length; c++) {
    var item = catalog[c];
    if (!item || !item.itemId) continue;
    var id = String(item.itemId);
    if (finalSet[id]) continue;
    if (lower.indexOf(id.toLowerCase()) >= 0) return true;
    var mentions = itemMentionTokens(item);
    for (var p = 0; p < mentions.phrases.length; p++) {
      if (lower.indexOf(mentions.phrases[p]) >= 0) return true;
    }
  }
  return false;
}

/** Short occasion/weather cue from session context (for titles + prose). */
function contextCue(context) {
  var text = String(context || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  text = text
    .replace(
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:looks?|outfits?|suggestions?|options?)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  var clause = text.split(/[.;]/)[0] || text;
  return clampText(clause.trim(), 64);
}

function pieceDetail(item) {
  var label = itemLabel(item);
  var fabric = String((item && item.fabric) || "").trim();
  if (
    fabric &&
    label.toLowerCase().indexOf(fabric.toLowerCase()) < 0
  ) {
    return label + " in " + fabric;
  }
  return label;
}

function uniqueNonEmpty(values) {
  var out = [];
  var seen = {};
  for (var i = 0; i < (values || []).length; i++) {
    var v = String(values[i] || "").trim();
    if (!v) continue;
    var key = v.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(v);
  }
  return out;
}

/**
 * Deterministic title + rationale from final pieces only (attrs + Wada names).
 * Verbose on purpose: catchy full titles; 2–4 advice sentences (occasion /
 * weather, materials, palette, why the set works) — Sonnet-like tone without
 * a second Bedrock call after slot repair.
 */
function rewriteLookCopy(look, byId, context) {
  var ids = lookItemIds(look);
  var pieces = ids
    .map(function (id) {
      return byId && typeof byId.get === "function" ? byId.get(id) : null;
    })
    .filter(Boolean);
  var anchor = null;
  for (var i = 0; i < pieces.length; i++) {
    if (classifySlot(pieces[i]) === "outer") {
      anchor = pieces[i];
      break;
    }
  }
  if (!anchor) {
    for (var b = 0; b < pieces.length; b++) {
      if (classifySlot(pieces[b]) === "base") {
        anchor = pieces[b];
        break;
      }
    }
  }
  if (!anchor && pieces.length) anchor = pieces[0];

  var cue = contextCue(context);
  var cold = contextNeedsColdLayer(context);
  var titleSeed;
  if (anchor) {
    var anchorCore = itemLabel(anchor).replace(/\s+/g, " ").trim();
    var mood = "";
    if (/\bgarden\b|\bpatio\b|\bterrace\b/i.test(cue)) mood = "Garden";
    else if (/\blunch\b|\bdinner\b|\bclient\b/i.test(cue)) mood = "Lunch";
    else if (/\bevening\b|\bnight\b/i.test(cue)) mood = "Evening";
    else if (cold) mood = "Layered";
    titleSeed = mood ? clampTitle(anchorCore + " " + mood) : anchorCore;
    // Prefer a fuller catchy title when mood fit still leaves headroom.
    if (!mood && cue) {
      var cueWord = cue.split(/\s+/).slice(0, 2).join(" ");
      if (cueWord && titleSeed.length + cueWord.length + 1 <= MAX_TITLE) {
        titleSeed = titleSeed + " " + cueWord;
      }
    }
  } else {
    titleSeed = cue ? cue : "Closet look";
  }
  var title = clampTitle(titleSeed);

  var details = pieces.map(pieceDetail);
  var wadaNames = uniqueNonEmpty(pieces.map(itemPrimaryWadaName));
  var fabrics = uniqueNonEmpty(
    pieces.map(function (p) {
      return p && p.fabric;
    })
  );
  var sentences = [];
  if (!details.length) {
    return Object.assign({}, look, { title: title, rationale: "" });
  }

  var occasionBit = cue
    ? "for " + cue
    : cold
      ? "for cool outdoor air"
      : "for this occasion";
  if (details.length === 1) {
    sentences.push(
      "Built around " + details[0] + " from your closet " + occasionBit + "."
    );
  } else if (anchor) {
    var support = pieces
      .filter(function (p) {
        return p !== anchor;
      })
      .map(pieceDetail)
      .slice(0, 3);
    sentences.push(
      pieceDetail(anchor) +
        " anchors the look " +
        occasionBit +
        (support.length
          ? ", with " + support.join(", ") + " keeping the line coherent."
          : ".")
    );
  } else {
    sentences.push(
      "Pairs " +
        details.slice(0, details.length - 1).join(", ") +
        (details.length > 1 ? ", and " + details[details.length - 1] : "") +
        " " +
        occasionBit +
        "."
    );
  }

  if (cold && anchor && classifySlot(anchor) === "outer") {
    sentences.push(
      "The outer layer earns its place against the chill without turning the rest of the closet theatrical."
    );
  } else if (fabrics.length) {
    sentences.push(
      "Materials stay honest for the brief: " +
        fabrics.slice(0, 3).join(", ") +
        " read as classic menswear rather than costume."
    );
  } else {
    sentences.push(
      "Shoe–trouser formality and the base layer stay aligned so nothing fights the occasion."
    );
  }

  if (wadaNames.length >= 2) {
    sentences.push(
      "Palette-wise, " +
        wadaNames.slice(0, 3).join(", ") +
        " keep the true-color story tidy across the pieces you actually wear."
    );
  } else if (wadaNames.length === 1) {
    sentences.push(
      "Primary Wada " +
        wadaNames[0] +
        " gives the set a clear colour centre without inventing hues."
    );
  } else if (details.length >= 3) {
    sentences.push(
      "Each listed piece pulls weight: nothing ornamental, nothing missing from the photos."
    );
  }

  var rationale = clampText(sentences.slice(0, 4).join(" "), MAX_RATIONALE);
  return Object.assign({}, look, { title: title, rationale: rationale });
}

/**
 * After salvage/repair, rewrite title/rationale when IDs changed or copy names
 * pieces that are not in the final look.
 */
function syncLookCopy(look, priorIds, byId, catalog, context) {
  var finalIds = lookItemIds(look);
  var changed = !sameIdList(priorIds, finalIds);
  var foreign = copyMentionsForeignPieces(
    look && look.title,
    look && look.rationale,
    finalIds,
    byId,
    catalog
  );
  if (!changed && !foreign) return look;
  console.warn(
    JSON.stringify({
      event: "suggest_copy_rewrite",
      lookId: look && look.lookId,
      reason: changed ? "ids_changed" : "foreign_copy",
    })
  );
  return rewriteLookCopy(look, byId, context);
}

function syncLooksCopy(looks, priorIdLists, byId, catalog, context) {
  var out = [];
  for (var i = 0; i < (looks || []).length; i++) {
    out.push(
      syncLookCopy(
        looks[i],
        (priorIdLists && priorIdLists[i]) || lookItemIds(looks[i]),
        byId,
        catalog,
        context
      )
    );
  }
  return out;
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
 * Completeness for a look. Core slots always; cold layer + waist finish when
 * options say the closet can fill (hard repairs). Accessories never fail alone.
 * Returns { ok, reasons } where reasons are codes like missing_base.
 */
function lookCompleteness(itemIds, byId, options) {
  // Legacy callers pass boolean requireFootwear as the third arg.
  var opts =
    typeof options === "boolean"
      ? { requireFootwear: options }
      : options || {};
  var hasBase = false;
  var hasTrousers = false;
  var hasFootwear = false;
  var slotCounts = {};
  for (var j = 0; j < (itemIds || []).length; j++) {
    var record = byId.get(itemIds[j]);
    var slot = classifySlot(record || {});
    if (slot === "base") hasBase = true;
    if (slot === "trousers") hasTrousers = true;
    if (slot === "footwear") hasFootwear = true;
    if (isUniqueSlot(slot)) {
      slotCounts[slot] = (slotCounts[slot] || 0) + 1;
    }
  }
  var reasons = [];
  if (!hasBase) reasons.push("missing_base");
  if (!hasTrousers) reasons.push("missing_trousers");
  if (opts.requireFootwear && !hasFootwear) reasons.push("missing_footwear");
  if ((slotCounts.base || 0) > 1) reasons.push("competing_bases");
  if ((slotCounts.footwear || 0) > 1) reasons.push("duplicate_footwear");
  if ((slotCounts.trousers || 0) > 1) reasons.push("duplicate_trousers");
  if ((slotCounts.outer || 0) > 1) reasons.push("duplicate_outer");
  if ((slotCounts.belt || 0) > 1) reasons.push("duplicate_belt");
  if (opts.requireColdLayer && !lookHasOuterLayer(itemIds, byId)) {
    reasons.push("missing_layer_for_cold");
  }
  if (opts.requireWaistFinish && !lookHasWaistFinish(itemIds, byId)) {
    reasons.push("missing_waist_finish");
  }
  return { ok: reasons.length === 0, reasons: reasons };
}

function completenessOptionsForLook(ids, byId, catalog, context) {
  var trousers = findLookTrousers(ids, byId);
  var requireWaistFinish = false;
  if (trousers && trousersNeedWaistFinish(trousers)) {
    var canBelt = catalogHasBelt(catalog);
    var canSuspenders =
      trousersSuspenderCapable(trousers) && catalogHasSuspenders(catalog);
    requireWaistFinish = canBelt || canSuspenders;
  }
  return {
    requireFootwear: catalogHasFootwear(catalog),
    requireColdLayer:
      contextNeedsColdLayer(context) && catalogHasSlot(catalog, "outer"),
    requireWaistFinish: requireWaistFinish,
  };
}

/**
 * Mark looks that fail mandatory core / hard layer / waist rules.
 * @returns {{ incomplete: Array<{ lookId: string, reasons: string[] }> }}
 */
function assertLooksComplete(looks, byId, catalog, context) {
  var incomplete = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var look = looks[i];
    var ids = lookItemIds(look);
    var opts = completenessOptionsForLook(ids, byId, catalog, context);
    var result = lookCompleteness(ids, byId, opts);
    if (!result.ok) {
      incomplete.push({
        lookId: String(look.lookId || i + 1),
        reasons: result.reasons,
      });
    }
  }
  return { incomplete: incomplete };
}

function usedIdsFromLooks(looks) {
  var used = new Set();
  for (var i = 0; i < (looks || []).length; i++) {
    var ids = lookItemIds(looks[i]);
    for (var j = 0; j < ids.length; j++) used.add(ids[j]);
  }
  return used;
}

function pickUnusedCandidate(catalog, usedIds, predicate) {
  var fresh = [];
  var any = [];
  for (var i = 0; i < (catalog || []).length; i++) {
    var item = catalog[i];
    if (!item || !item.itemId || !predicate(item)) continue;
    any.push(item);
    if (!usedIds.has(String(item.itemId))) fresh.push(item);
  }
  var pool = fresh.length ? fresh : any;
  return pool.length ? pool[0] : null;
}

function footwearFormality(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (classifySlot(record || {}) === "footwear") {
      return String((record && record.formality) || "")
        .toLowerCase()
        .trim();
    }
  }
  return "";
}

function pickWaistFinish(catalog, usedIds, trousers, ids, byId, context) {
  var dressy = /\b(dress|formal|black\s*tie|opera|wedding|ceremony)\b/i.test(
    String(context || "")
  );
  var preferSuspenders =
    trousersSuspenderCapable(trousers) &&
    (dressy || !catalogHasBelt(catalog));
  if (preferSuspenders) {
    var suspenders = pickUnusedCandidate(catalog, usedIds, isSuspendersItem);
    if (suspenders) return suspenders;
  }
  var shoeFormality = footwearFormality(ids, byId);
  var belts = [];
  for (var i = 0; i < (catalog || []).length; i++) {
    if (isBeltItem(catalog[i])) belts.push(catalog[i]);
  }
  belts.sort(function (a, b) {
    var aFresh = usedIds.has(String(a.itemId)) ? 1 : 0;
    var bFresh = usedIds.has(String(b.itemId)) ? 1 : 0;
    if (aFresh !== bFresh) return aFresh - bFresh;
    if (shoeFormality) {
      var aMatch =
        String(a.formality || "")
          .toLowerCase()
          .indexOf(shoeFormality) >= 0
          ? 0
          : 1;
      var bMatch =
        String(b.formality || "")
          .toLowerCase()
          .indexOf(shoeFormality) >= 0
          ? 0
          : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return 0;
  });
  if (belts.length) return belts[0];
  if (trousersSuspenderCapable(trousers)) {
    return pickUnusedCandidate(catalog, usedIds, isSuspendersItem);
  }
  return null;
}

/**
 * Deterministic attach repairs for core gaps, cold layer, and waist finish.
 * Returns { look, repairs: string[] }.
 */
function repairLookLocally(look, byId, catalog, context, globalUsed) {
  var ids = lookItemIds(look).slice();
  // Empty model/pad looks are dropped + backfilled from unused pieces — do not
  // clone a full core onto blanks just to hit N.
  if (!ids.length) {
    return { look: look, repairs: [] };
  }
  var used = new Set(globalUsed || []);
  for (var u = 0; u < ids.length; u++) used.add(ids[u]);
  var repairs = [];
  var opts = completenessOptionsForLook(ids, byId, catalog, context);
  var result = lookCompleteness(ids, byId, opts);

  function attach(predicate, reason) {
    var pick = pickUnusedCandidate(catalog, used, predicate);
    if (!pick) return false;
    ids.push(String(pick.itemId));
    used.add(String(pick.itemId));
    repairs.push(reason);
    return true;
  }

  if (result.reasons.indexOf("missing_base") >= 0) {
    attach(function (item) {
      return classifySlot(item) === "base";
    }, "attach_base");
  }
  if (result.reasons.indexOf("missing_trousers") >= 0) {
    attach(function (item) {
      return classifySlot(item) === "trousers";
    }, "attach_trousers");
  }
  if (result.reasons.indexOf("missing_footwear") >= 0) {
    attach(function (item) {
      return classifySlot(item) === "footwear";
    }, "attach_footwear");
  }

  opts = completenessOptionsForLook(ids, byId, catalog, context);
  result = lookCompleteness(ids, byId, opts);
  if (result.reasons.indexOf("missing_layer_for_cold") >= 0) {
    if (
      attach(function (item) {
        return classifySlot(item) === "outer";
      }, "attach_layer_for_cold")
    ) {
      console.warn(
        JSON.stringify({
          event: "suggest_layer_repair",
          lookId: look.lookId,
        })
      );
    }
  }

  opts = completenessOptionsForLook(ids, byId, catalog, context);
  result = lookCompleteness(ids, byId, opts);
  if (result.reasons.indexOf("missing_waist_finish") >= 0) {
    var trousers = findLookTrousers(ids, byId);
    var finish = trousers
      ? pickWaistFinish(catalog, used, trousers, ids, byId, context)
      : null;
    if (finish) {
      ids.push(String(finish.itemId));
      used.add(String(finish.itemId));
      repairs.push("attach_waist_finish");
      console.warn(
        JSON.stringify({
          event: "suggest_waist_finish_repair",
          lookId: look.lookId,
          kind: isSuspendersItem(finish) ? "suspenders" : "belt",
        })
      );
    }
  }

  var next = Object.assign({}, look, { itemIds: ids });
  if (look.items && !look.itemIds) {
    next.items = ids
      .map(function (id) {
        return byId.get(id);
      })
      .filter(Boolean);
    delete next.itemIds;
  }
  return { look: next, repairs: repairs };
}

function repairLooksLocally(looks, byId, catalog, context) {
  var used = usedIdsFromLooks(looks);
  var out = [];
  var repairCounts = { layer: 0, waist: 0, core: 0 };
  for (var i = 0; i < (looks || []).length; i++) {
    var repaired = repairLookLocally(
      looks[i],
      byId,
      catalog,
      context,
      used
    );
    for (var r = 0; r < repaired.repairs.length; r++) {
      var code = repaired.repairs[r];
      if (code === "attach_layer_for_cold") repairCounts.layer += 1;
      else if (code === "attach_waist_finish") repairCounts.waist += 1;
      else repairCounts.core += 1;
    }
    var ids = lookItemIds(repaired.look);
    for (var j = 0; j < ids.length; j++) used.add(ids[j]);
    out.push(repaired.look);
  }
  return { looks: out, repairCounts: repairCounts };
}

function filterCompleteLooks(looks, byId, catalog, context) {
  var kept = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var look = looks[i];
    var ids = lookItemIds(look);
    var opts = completenessOptionsForLook(ids, byId, catalog, context);
    var result = lookCompleteness(ids, byId, opts);
    if (result.ok && ids.length) {
      kept.push(look);
    } else {
      console.warn(
        JSON.stringify({
          event: "suggest_dropped_incomplete",
          lookId: look && look.lookId,
          reasons: result.reasons,
        })
      );
    }
  }
  return kept;
}

/**
 * Deterministic fill looks to top up toward N using unused catalog pieces.
 */
function backfillLooksDeterministic(existing, catalog, context, lookCount) {
  var byId = catalogById(catalog);
  var need = clampLookCount(lookCount) - (existing || []).length;
  if (need <= 0) return existing || [];
  var used = usedIdsFromLooks(existing);
  var allCatalog = catalog || [];
  var leftoverCatalog = allCatalog.filter(function (item) {
    return item && item.itemId && !used.has(String(item.itemId));
  });
  // Only fill from unused pieces — do not clone the same core across looks
  // just to hit N; honest shortfall is preferred.
  if (leftoverCatalog.length < 2) {
    return existing || [];
  }
  var generated = assembleRandomLooks(leftoverCatalog, {
    lookCount: need,
    random: Math.random,
  });
  var asIds = generated.map(function (look, index) {
    return {
      lookId: String((existing || []).length + index + 1),
      title: look.title || "",
      rationale: look.rationale || "",
      itemIds: (look.items || [])
        .map(function (item) {
          return item && item.itemId ? String(item.itemId) : "";
        })
        .filter(Boolean),
    };
  });
  var prior = asIds.map(lookItemIds);
  var repaired = repairLooksLocally(asIds, byId, allCatalog, context);
  repaired.looks = enforceSlotUniqueness(repaired.looks, byId);
  repaired.looks = syncLooksCopy(
    repaired.looks,
    prior,
    byId,
    allCatalog,
    context
  );
  var complete = filterCompleteLooks(
    repaired.looks,
    byId,
    allCatalog,
    context
  );
  return (existing || []).concat(complete).slice(0, clampLookCount(lookCount));
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
    STYLE_PACK_V1,
    "When a catalog row includes wada / wadaId, treat that Sanzo Wada English name as the item's colour (DressMe's only colour attribute); prefer colour harmony using those named references when present. Items without wada have no colour label.",
    softWadaPriorText(),
    "Return exactly " +
      count +
      " distinct looks as JSON only (no prose outside JSON).",
    "Each look: ordered itemIds (catalog id strings) + title (catchy but full name for the look's key idea, about 3–7 words, ≤48 chars) + rationale (2–4 sentences of thoughtful menswear advice:",
    "occasion/weather, materials, Wada/palette harmony, and why these pieces work together — plain language, only from this look's itemIds).",
    "Each look MUST include the mandatory core: base (shirt/knit/polo/tee) + bottom (trousers/jeans/chinos/shorts), plus footwear when shoes exist in the catalog.",
    "Slot uniqueness: at most one base, one bottom, one footwear, and one outer/mid-layer per look. Never two shoes, two jackets, or two competing tops.",
    "Outerwear may layer over a single base. Distinct accessory types (hat, scarf, etc.) may co-exist; still at most one belt or suspenders.",
    "When context is cold / cool / outdoor evening / garden / patio, include a warm outer or mid layer when the catalog has candidates.",
    "When trousers need a waist finish (not side-adjuster/beltless), include a belt — or suspenders/braces when the trousers' aiContext supports them.",
    "Accessories beyond waist finish remain optional — hat, scarf, jewelry, bag, neckwear, etc. Add them when they improve the look or fit the occasion.",
    "Title and rationale must name only pieces present in that look's itemIds (use type / brandModel / Wada colour). Never describe a cardigan if the look's outer is a leather jacket.",
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
    "These looks failed completeness: " +
    bits.join("; ") +
    ". Fix each look: include base + bottom" +
    " (+ footwear when the catalog has shoes). At most one base, one bottom, one footwear, one outer; outer may layer." +
    " If duplicate_footwear / duplicate_outer / competing_bases: keep a single piece in that slot." +
    " If missing_layer_for_cold: add a warm outer/mid layer from the catalog." +
    " If missing_waist_finish: add a belt, or suspenders when trousers support them." +
    " Other accessories remain optional. Titles/rationales must match the final itemIds only — keep titles catchy but full and rationales 2–4 thoughtful sentences (not one-liners)." +
    " Return " +
    count +
    " complete looks with valid itemIds."
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
 * Bedrock text suggest: attrs + aiContext only; validate IDs; repair; backfill.
 * Caps Bedrock at primary (+ optional JSON/id/completeness repair) + at most
 * one fill pass. Hard layer/waist fixes prefer deterministic attach. Optional
 * second passes are skipped once SECOND_PASS_DEADLINE_MS elapses so CloudFront
 * (origin_read_timeout 60s) does not 504 a successful Lambda.
 */
async function assembleWithBedrock(catalog, input) {
  var lookCount = clampLookCount(
    input && input.lookCount != null ? input.lookCount : DEFAULT_LOOK_COUNT
  );
  var context = (input && input.context) || "";
  var compact = serializeCatalogForPrompt(catalog);
  var allowedIds = catalogIdSet(catalog);
  var byId = catalogById(catalog);
  var catalogJson = JSON.stringify(compact);
  var system = systemPrompt(lookCount);
  var bedrockCalls = 0;
  var inputTokens = 0;
  var outputTokens = 0;
  var lastModelId = modelId();
  var startedAt = nowMs();

  function withinSecondPassBudget() {
    return nowMs() - startedAt < SECOND_PASS_DEADLINE_MS;
  }

  function canOptionalBedrockPass() {
    return bedrockCalls < 2 && withinSecondPassBudget();
  }

  async function callBedrock(userText) {
    var result = await invokeBedrockWithRetry(system, userText, lookCount);
    bedrockCalls += 1;
    lastModelId = result.modelId || lastModelId;
    if (typeof result.inputTokens === "number") {
      inputTokens += result.inputTokens;
    }
    if (typeof result.outputTokens === "number") {
      outputTokens += result.outputTokens;
    }
    return result;
  }

  var bedrockResult;
  try {
    bedrockResult = await callBedrock(
      userPrompt(context, catalogJson, null, lookCount)
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
      bedrockResult = await callBedrock(
        userPrompt(
          context,
          catalogJson,
          "Previous reply was not valid JSON. Return ONLY the schema object.",
          lookCount
        )
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

  if (validated.emptyLookCount > 0 && canOptionalBedrockPass()) {
    var idList = compact
      .map(function (row) {
        return row.id;
      })
      .filter(Boolean)
      .join(", ");
    try {
      bedrockResult = await callBedrock(
        userPrompt(
          context,
          catalogJson,
          "Invalid or empty itemIds were removed. Pick ONLY from this ID list: " +
            idList +
            ". Return " +
            lookCount +
            " looks with valid itemIds.",
          lookCount
        )
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        lookCount
      );
    } catch (_repairErr) {
      console.warn(
        JSON.stringify({
          event: "suggest_invalid_item_ids",
          stage: "repair_failed_continue_local",
        })
      );
    }
  } else if (validated.emptyLookCount > 0 && bedrockCalls < 2) {
    console.warn(
      JSON.stringify({
        event: "suggest_second_pass_skipped",
        reason: "time_budget",
        stage: "invalid_item_ids",
        elapsedMs: nowMs() - startedAt,
      })
    );
  }

  // Keep non-empty looks; empties are dropped and may be backfilled below.
  validated.looks = (validated.looks || []).filter(function (look) {
    return lookItemIds(look).length > 0;
  });
  if (!validated.looks.length) {
    throw Object.assign(new Error("suggest_invalid_item_ids"), {
      statusCode: 502,
    });
  }

  var priorIdsBeforeDedupe = (validated.looks || []).map(lookItemIds);
  validated.looks = enforceSlotUniqueness(validated.looks, byId);
  var completeness = assertLooksComplete(
    validated.looks,
    byId,
    catalog,
    context
  );
  if (completeness.incomplete.length && canOptionalBedrockPass()) {
    try {
      bedrockResult = await callBedrock(
        userPrompt(
          context,
          catalogJson,
          completenessRepairNote(completeness.incomplete, lookCount),
          lookCount
        )
      );
      validated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        lookCount
      );
      priorIdsBeforeDedupe = (validated.looks || []).map(lookItemIds);
      validated.looks = enforceSlotUniqueness(validated.looks, byId);
    } catch (_repairErr) {
      console.warn(
        JSON.stringify({
          event: "suggest_incomplete_looks",
          stage: "repair_failed_continue_local",
          incomplete: completeness.incomplete,
        })
      );
    }
  } else if (completeness.incomplete.length && bedrockCalls < 2) {
    console.warn(
      JSON.stringify({
        event: "suggest_second_pass_skipped",
        reason: "time_budget",
        stage: "completeness_repair",
        elapsedMs: nowMs() - startedAt,
      })
    );
  }

  var local = repairLooksLocally(validated.looks, byId, catalog, context);
  local.looks = enforceSlotUniqueness(local.looks, byId);
  local.looks = syncLooksCopy(
    local.looks,
    priorIdsBeforeDedupe,
    byId,
    catalog,
    context
  );
  var completeLooks = filterCompleteLooks(
    local.looks,
    byId,
    catalog,
    context
  );

  if (completeLooks.length < lookCount) {
    completeLooks = backfillLooksDeterministic(
      completeLooks,
      catalog,
      context,
      lookCount
    );
  }

  // Optional one Bedrock fill when still short and call + time budget allow.
  if (completeLooks.length < lookCount && canOptionalBedrockPass()) {
    var missing = lookCount - completeLooks.length;
    try {
      bedrockResult = await callBedrock(
        userPrompt(
          context,
          catalogJson,
          "Return " +
            missing +
            " additional complete looks that diversify from these existing itemId sets: " +
            JSON.stringify(
              completeLooks.map(function (look) {
                return lookItemIds(look);
              })
            ) +
            ". Same schema; only the new looks array (length " +
            missing +
            ").",
          missing
        )
      );
      var fillValidated = validateLookPayload(
        parseJsonObject(bedrockResult.text),
        allowedIds,
        missing
      );
      fillValidated.looks = enforceSlotUniqueness(fillValidated.looks, byId);
      var fillPrior = (fillValidated.looks || []).map(lookItemIds);
      var fillLocal = repairLooksLocally(
        fillValidated.looks,
        byId,
        catalog,
        context
      );
      fillLocal.looks = enforceSlotUniqueness(fillLocal.looks, byId);
      fillLocal.looks = syncLooksCopy(
        fillLocal.looks,
        fillPrior,
        byId,
        catalog,
        context
      );
      var fillComplete = filterCompleteLooks(
        fillLocal.looks,
        byId,
        catalog,
        context
      );
      completeLooks = completeLooks.concat(fillComplete).slice(0, lookCount);
    } catch (_fillErr) {
      console.warn(
        JSON.stringify({
          event: "suggest_fill_failed",
          requested: lookCount,
          have: completeLooks.length,
        })
      );
    }
  } else if (completeLooks.length < lookCount && bedrockCalls < 2) {
    console.warn(
      JSON.stringify({
        event: "suggest_second_pass_skipped",
        reason: "time_budget",
        stage: "fill_pass",
        elapsedMs: nowMs() - startedAt,
        requested: lookCount,
        have: completeLooks.length,
      })
    );
  }

  if (!completeLooks.length) {
    console.error(
      JSON.stringify({
        event: "suggest_incomplete_looks",
        stage: "no_complete_looks",
        requestedLookCount: lookCount,
      })
    );
    throw Object.assign(new Error("suggest_incomplete_looks"), {
      statusCode: 502,
    });
  }

  var shortfall = completeLooks.length < lookCount;
  if (shortfall) {
    console.warn(
      JSON.stringify({
        event: "suggest_look_count_shortfall",
        requestedLookCount: lookCount,
        returnedLookCount: completeLooks.length,
        layerRepairs: local.repairCounts.layer,
        waistRepairs: local.repairCounts.waist,
        modelId: lastModelId,
      })
    );
  }

  var looks = completeLooks.map(function (look, index) {
    var ids = lookItemIds(look);
    return {
      lookId: String(index + 1),
      title: look.title || "",
      rationale: look.rationale || "",
      items: ids
        .map(function (id) {
          return byId.get(id);
        })
        .filter(Boolean),
    };
  });

  return {
    looks: looks,
    modelId: lastModelId,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    requestedLookCount: lookCount,
    returnedLookCount: looks.length,
    lookCountShortfall: shortfall,
    repairCounts: local.repairCounts,
    bedrockCalls: bedrockCalls,
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
  var countMeta = {
    requestedLookCount: lookCount,
    returnedLookCount: lookCount,
    lookCountShortfall: false,
  };
  var byIdSuggest = catalogById(catalog);
  if (engine === "random") {
    var randomLooks = filterRandomLooksComplete(
      assembleRandomLooks(catalog, {
        random: Math.random,
        lookCount: lookCount,
      }),
      catalog
    );
    var randomAsIds = randomLooks.map(function (look) {
      return {
        lookId: look.lookId,
        title: look.title || "",
        rationale: look.rationale || "",
        itemIds: (look.items || [])
          .map(function (item) {
            return item && item.itemId ? String(item.itemId) : "";
          })
          .filter(Boolean),
      };
    });
    var randomRepaired = repairLooksLocally(
      randomAsIds,
      byIdSuggest,
      catalog,
      context
    );
    var randomComplete = filterCompleteLooks(
      randomRepaired.looks,
      byIdSuggest,
      catalog,
      context
    );
    if (randomComplete.length < lookCount) {
      randomComplete = backfillLooksDeterministic(
        randomComplete,
        catalog,
        context,
        lookCount
      );
    }
    rawLooks = randomComplete.map(function (look, index) {
      var ids = lookItemIds(look);
      return {
        lookId: String(index + 1),
        title: look.title || "",
        rationale: look.rationale || "",
        items: ids
          .map(function (id) {
            return byIdSuggest.get(id);
          })
          .filter(Boolean),
      };
    });
    countMeta.returnedLookCount = rawLooks.length;
    countMeta.lookCountShortfall = rawLooks.length < lookCount;
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
        repairCounts: assembled.repairCounts,
        bedrockCalls: assembled.bedrockCalls,
      };
      countMeta.requestedLookCount = assembled.requestedLookCount;
      countMeta.returnedLookCount = assembled.returnedLookCount;
      countMeta.lookCountShortfall = Boolean(assembled.lookCountShortfall);
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

  var nonEmpty = looks.filter(function (look) {
    return look.items && look.items.length > 0;
  });
  if (engine === "bedrock" && !(catalog || []).length) {
    // Keep N empty pads so SPA can show the empty-catalog copy.
  } else if (nonEmpty.length > 0) {
    looks = nonEmpty.map(function (look, index) {
      return Object.assign({}, look, { lookId: String(index + 1) });
    });
    if (looks.length > lookCount) {
      looks = looks.slice(0, lookCount);
    }
    countMeta.returnedLookCount = looks.length;
    countMeta.lookCountShortfall = looks.length < lookCount;
  } else {
    // Closet cannot form a complete look — pad empties for SPA messaging.
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
    countMeta.returnedLookCount = 0;
    countMeta.lookCountShortfall = lookCount > 0;
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
        requestedLookCount: countMeta.requestedLookCount,
        returnedLookCount: countMeta.returnedLookCount,
        lookCountShortfall: countMeta.lookCountShortfall,
        layerRepairs:
          bedrockMeta.repairCounts && bedrockMeta.repairCounts.layer,
        waistRepairs:
          bedrockMeta.repairCounts && bedrockMeta.repairCounts.waist,
        bedrockCalls: bedrockMeta.bedrockCalls,
      })
    );
  }

  var responseBody = {
    engine: engine,
    context: context,
    looks: looks,
    suggestionId: suggestionId,
    requestedLookCount: countMeta.requestedLookCount,
    returnedLookCount: countMeta.returnedLookCount,
  };
  if (countMeta.lookCountShortfall) {
    responseBody.lookCountShortfall = true;
  }
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
exports.STYLE_PACK_V1 = STYLE_PACK_V1;
exports.classifySlot = classifySlot;
exports.UNIQUE_SLOTS = UNIQUE_SLOTS;
exports.enforceSlotUniqueness = enforceSlotUniqueness;
exports.salvageCompetingBases = salvageCompetingBases;
exports.rewriteLookCopy = rewriteLookCopy;
exports.syncLookCopy = syncLookCopy;
exports.syncLooksCopy = syncLooksCopy;
exports.copyMentionsForeignPieces = copyMentionsForeignPieces;
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
exports.SECOND_PASS_DEADLINE_MS = SECOND_PASS_DEADLINE_MS;
exports.modelId = modelId;
exports.contextNeedsColdLayer = contextNeedsColdLayer;
exports.trousersNeedWaistFinish = trousersNeedWaistFinish;
exports.trousersSuspenderCapable = trousersSuspenderCapable;
exports.isBeltItem = isBeltItem;
exports.isSuspendersItem = isSuspendersItem;
exports.repairLookLocally = repairLookLocally;
exports.repairLooksLocally = repairLooksLocally;
exports.backfillLooksDeterministic = backfillLooksDeterministic;
exports.filterCompleteLooks = filterCompleteLooks;
exports.softWadaPriorText = softWadaPriorText;
