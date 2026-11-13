"use strict";

var core = require("./core");

var BELT_ITEM_RE = core.BELT_ITEM_RE;
var BROKEN_COPY_RE = core.BROKEN_COPY_RE;
var COLD_OUTDOOR_RE = core.COLD_OUTDOOR_RE;
var COLOR_WORD_RE = core.COLOR_WORD_RE;
var DEFAULT_LOOK_COUNT = core.DEFAULT_LOOK_COUNT;
var DEFAULT_MODEL_ID = core.DEFAULT_MODEL_ID;
var DEFAULT_PACKING_LIMIT = core.DEFAULT_PACKING_LIMIT;
var FORMALITY_RANK = core.FORMALITY_RANK;
var FORMULAIC_COPY_RES = core.FORMULAIC_COPY_RES;
var LEATHER_TONE_FAMILIES = core.LEATHER_TONE_FAMILIES;
var LOOK_COUNT = core.LOOK_COUNT;
var LOOK_NOUN = core.LOOK_NOUN;
var MAX_AI_CONTEXT_PROMPT = core.MAX_AI_CONTEXT_PROMPT;
var MAX_CONTEXT = core.MAX_CONTEXT;
var MAX_EXCLUDE_ITEM_IDS = core.MAX_EXCLUDE_ITEM_IDS;
var MAX_LOOK_COUNT = core.MAX_LOOK_COUNT;
var MAX_RATIONALE = core.MAX_RATIONALE;
var MAX_TITLE = core.MAX_TITLE;
var MIN_LOOK_COUNT = core.MIN_LOOK_COUNT;
var SECOND_PASS_DEADLINE_MS = core.SECOND_PASS_DEADLINE_MS;
var SIDE_ADJUSTER_RE = core.SIDE_ADJUSTER_RE;
var SLOT_DEFS = core.SLOT_DEFS;
var SOFT_CATALOG_CAP = core.SOFT_CATALOG_CAP;
var STYLE_PACK_V1 = core.STYLE_PACK_V1;
var SUSPENDERS_ITEM_RE = core.SUSPENDERS_ITEM_RE;
var SUSPENDER_CAPABLE_RE = core.SUSPENDER_CAPABLE_RE;
var TRIP_LUGGAGE_RE = core.TRIP_LUGGAGE_RE;
var UNIQUE_SLOTS = core.UNIQUE_SLOTS;
var WORD_COUNTS = core.WORD_COUNTS;
var bedrockClient = core.bedrockClient;
var classifySlot = core.classifySlot;
var deps = core.deps;
var formalityRank = core.formalityRank;
var isUniqueSlot = core.isUniqueSlot;
var itemRoleTypeText = core.itemRoleTypeText;
var itemSearchText = core.itemSearchText;
var lookTargetFormality = core.lookTargetFormality;
var modelId = core.modelId;
var nowMs = core.nowMs;
var resetDepsForTests = core.resetDepsForTests;
var slotDefById = core.slotDefById;
var contextNeedsColdLayer = core.contextNeedsColdLayer;
var contextHasCoolWeather = core.contextHasCoolWeather;
var contextImpliesOutdoorActivity = core.contextImpliesOutdoorActivity;
var contextImpliesIndoorDressup = core.contextImpliesIndoorDressup;
var lookItemIds = core.lookItemIds;
var catalogById = core.catalogById;
var parseJsonObject = core.parseJsonObject;
var itemPrimaryWadaName = core.itemPrimaryWadaName;
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
 * Digits or word numbers near look/outfit synonyms; default 3; clamp 1–8.
 * Allows a few intervening adjectives ("one colorful outfit", "two smart looks").
 * Never 400s — out-of-range values clamp and still suggest.
 */
function extractLookCount(context) {
  var text = String(context || "").toLowerCase();
  if (!text.trim()) return DEFAULT_LOOK_COUNT;

  // Short modifiers between count and noun ("one colorful outfit").
  var adj = "(?:[a-z]+(?:-[a-z]+)?\\s+){0,3}";

  var patterns = [
    // "5 looks", "5 colorful outfits please"
    new RegExp("\\b(\\d{1,2})\\s*" + adj + LOOK_NOUN + "\\b", "i"),
    // "looks: 5", "outfits = 4"
    new RegExp("\\b" + LOOK_NOUN + "\\s*[:=]?\\s*(\\d{1,2})\\b", "i"),
    // "five looks", "two smart outfits", "one colorful outfit", "just one look"
    new RegExp(
      "\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\s+" +
        adj +
        LOOK_NOUN +
        "\\b",
      "i"
    ),
    // "a look" / "an outfit" / "a single colorful look" / "single outfit" → 1
    new RegExp(
      "\\b(?:(?:a|an)\\s+(?:(?:single|sole)\\s+)?|(?:single|sole)\\s+)" +
        adj +
        LOOK_NOUN +
        "\\b",
      "i"
    ),
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
function parseCountToken(raw) {
  var key = String(raw || "")
    .toLowerCase()
    .trim();
  if (WORD_COUNTS[key] != null) return WORD_COUNTS[key];
  var n = parseInt(key, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clean one occasion body from a multi-slot match.
 */
function cleanOccasionBody(raw) {
  return String(raw || "")
    .replace(/^[-–•]\s*/, "")
    .replace(/\s*[-–]\s*$/, "")
    .trim();
}

/**
 * Day 1: … Day 2: … labeled slots.
 */
function extractDayLabeledOccasions(text) {
  var occasions = [];
  var re =
    /Day\s*(\d+)\s*:\s*(.+?)(?=(?:\s*[-–•]?\s*)Day\s*\d+\s*:|$)/gi;
  var match;
  while ((match = re.exec(text)) !== null) {
    var body = cleanOccasionBody(match[2]);
    if (!body) continue;
    occasions.push(buildOccasionMeta(Number(match[1]), body));
  }
  return occasions;
}

/**
 * Outfit 1: … / Look 2 — … / "For Outfit 1 …" labeled slots.
 * Position-based (not delimiter-strict): space, comma, or no punctuation after
 * the number still splits — Cologne free text often omits the colon.
 * Requires ≥2 markers so a lone "Outfit 1" does not invent a trip plan.
 */
function extractOutfitLabeledOccasions(text) {
  var markerRe =
    /(?:(?:for|for\s+my)\s+)?(?:outfit|look)\s*(\d+)\b/gi;
  var markers = [];
  var match;
  while ((match = markerRe.exec(text)) !== null) {
    markers.push({
      day: Number(match[1]),
      bodyStart: match.index + match[0].length,
      markerStart: match.index,
    });
  }
  if (markers.length < 2) return [];

  var occasions = [];
  for (var i = 0; i < markers.length; i++) {
    var end =
      i + 1 < markers.length ? markers[i + 1].markerStart : text.length;
    var raw = text.slice(markers[i].bodyStart, end);
    var body = cleanOccasionBody(raw.replace(/^[:.\-–—,)]\s*/, ""));
    // Drop trailing packing / preamble glue after the last slot when possible.
    if (i === markers.length - 1) {
      body = body
        .replace(
          /\s+(?:pack(?:ing|ed)?|luggage|for luggage|don'?t want|at most|no more than)\b[\s\S]*$/i,
          ""
        )
        .trim();
    }
    if (!body) continue;
    occasions.push(buildOccasionMeta(markers[i].day, body));
  }
  return occasions;
}

/**
 * Numbered list slots: "1) … 2) …" or "1. … 2. …".
 * Requires ≥2 hits so a lone "1." in prose does not invent a trip plan.
 */
function extractNumberedListOccasions(text) {
  var occasions = [];
  var re =
    /(?:^|[;•]|\s[-–]\s|\s)\(?\s*(\d{1,2})\s*[.)]\s+(.+?)(?=(?:\s*(?:[;•]|\s[-–]\s)\s*)?(?:\(?\s*\d{1,2}\s*[.)]\s+)|$)/gi;
  var match;
  while ((match = re.exec(text)) !== null) {
    var body = cleanOccasionBody(match[2]);
    if (!body) continue;
    // Skip temp-like noise ("10°C …") captured as a fake slot.
    if (/^[°º]/.test(body) || /^(?:c|f|celsius|fahrenheit)\b/i.test(body)) {
      continue;
    }
    occasions.push(buildOccasionMeta(Number(match[1]), body));
  }
  if (occasions.length < 2) return [];
  return occasions;
}

/**
 * Structured day/occasion list from multi-slot briefs:
 * Day 1: …, Outfit 1: …, or numbered 1) / 1. lists.
 * Soft formality hints for board vs casual/train vs dinner vs dress-up.
 */
function parseOccasions(context, lookCount) {
  var text = String(context || "").replace(/\s+/g, " ").trim();
  var occasions = [];
  if (!text) return occasions;

  occasions = extractDayLabeledOccasions(text);
  if (!occasions.length) {
    occasions = extractOutfitLabeledOccasions(text);
  }
  if (!occasions.length) {
    occasions = extractNumberedListOccasions(text);
  }

  occasions.sort(function (a, b) {
    return (a.day || 0) - (b.day || 0);
  });
  if (!occasions.length) {
    // Single-occasion fallback from keyword cues (no raw context paste).
    var single = inferOccasionFromText(text, 1);
    if (single) occasions.push(single);
  }
  var limit = clampLookCount(
    lookCount != null ? lookCount : occasions.length || DEFAULT_LOOK_COUNT
  );
  if (occasions.length > limit) occasions = occasions.slice(0, limit);
  return occasions;
}

function formalityHintFromText(body) {
  var t = String(body || "").toLowerCase();
  // Explicit black/white tie or opera *gala* only — bare "Phantom of the Opera"
  // / "dress up" is theatre formal, not black tie.
  if (/\b(black\s*-?\s*tie|white\s*-?\s*tie)\b/.test(t)) {
    return "black tie";
  }
  if (/\bopera\s+gala\b/.test(t) || (/\bgala\b/.test(t) && !/\bphantom\b/.test(t))) {
    return "black tie";
  }
  if (
    /\bformal\b/.test(t) ||
    /\b(dress[- ]?up|theatre|theater|musical|phantom|opera)\b/.test(t)
  ) {
    return "formal";
  }
  if (/\b(board|boardroom)\b/.test(t)) return "business";
  if (/\b(casual)\b/.test(t) && /\b(train|travel|meeting)\b/.test(t)) {
    return "smart casual";
  }
  if (/\b(casual|weekend|jeans)\b/.test(t)) return "casual";
  if (/\b(dinner|client|colleagues?|business|office|meeting)\b/.test(t)) {
    return "business";
  }
  if (/\b(train|travel|smart\s*casual)\b/.test(t)) return "smart casual";
  return "";
}

function shortTitleFromOccasionBody(body, day) {
  var t = String(body || "").toLowerCase();
  if (/\bboard\b/.test(t)) return "Board day";
  if (/\b(opera|musical|phantom)\b/.test(t)) return "Musical night";
  if (/\b(theatre|theater)\b/.test(t)) return "Theatre night";
  if (/\bdress[- ]?up\b/.test(t)) return "Dress-up evening";
  if (/\btrain\b/.test(t) && /\bdinner\b/.test(t)) return "Train-to-dinner";
  if (/\bcasual\b/.test(t) && /\btrain\b/.test(t)) return "Casual train";
  if (/\bdinner\b/.test(t) && /\b(client|colleague)/.test(t)) {
    return "Client dinner";
  }
  if (/\bgarden\b|\bpatio\b|\bterrace\b/.test(t)) return "Garden evening";
  if (/\bbreakfast\b/.test(t)) return "Breakfast look";
  if (/\bdinner\b/.test(t)) return "Dinner look";
  if (/\blunch\b/.test(t)) return "Lunch look";
  if (/\b(explore|exploring|sightseeing|city\s*walk)\b/.test(t)) {
    return "City explore";
  }
  if (/\btrain\b|\btravel/.test(t)) return "Travel day";
  if (/\bcasual\b/.test(t)) return "Casual day";
  if (day) return "Day " + day;
  return "Day look";
}

function buildOccasionMeta(day, body) {
  return {
    day: day || null,
    label: day ? "Day " + day : "Occasion",
    shortTitle: shortTitleFromOccasionBody(body, day),
    formalityHint: formalityHintFromText(body),
    body: clampText(body, 160),
  };
}

function inferOccasionFromText(text, day) {
  var t = String(text || "");
  // Multi Outfit/Look markers belong in extractOutfitLabeledOccasions — never
  // collapse them into one Musical/Travel title from the whole brief.
  var outfitMarkers = t.match(
    /(?:(?:for|for\s+my)\s+)?(?:outfit|look)\s*\d+\b/gi
  );
  if (outfitMarkers && outfitMarkers.length >= 2) {
    return null;
  }
  if (
    !/\b(board|dinner|lunch|garden|patio|train|travel|casual|client|evening|office|opera|theatre|theater|musical|phantom|dress[- ]?up|breakfast|explore)\b/i.test(
      t
    )
  ) {
    return null;
  }
  // Scan the full brief for title/formality — only the stored body is clamped.
  return buildOccasionMeta(day || null, t);
}

/**
 * Luggage limits from context. Trip/luggage language → default 2 each for
 * footwear / trousers / outer when no explicit N is found.
 */
function parsePackingLimits(context) {
  var text = String(context || "");
  if (!text.trim()) return null;
  var hasTrip = TRIP_LUGGAGE_RE.test(text);
  var n = null;
  var bundled = text.match(
    /(?:don'?t want.{0,48}|no more than|at most|max(?:imum)?|≤|<=)\s*(\d+|one|two|three|four)\s*(?:pairs?\s+of\s+)?(?:shoes?|footwear)[,\s]+(?:trousers|pants)[,\s]+(?:and\s+)?(?:jackets?|coats?|blazers?)/i
  );
  if (bundled) n = parseCountToken(bundled[1]);
  if (n == null) {
    var shoe = text.match(
      /(?:no more than|at most|max(?:imum)?|≤|<=)\s*(\d+|one|two|three|four)\s*(?:pairs?\s+of\s+)?(?:shoes?|footwear)/i
    );
    if (shoe) n = parseCountToken(shoe[1]);
  }
  if (n == null && !hasTrip) return null;
  var limit = n != null ? n : DEFAULT_PACKING_LIMIT;
  if (limit < 1) limit = 1;
  if (limit > 8) limit = 8;
  return { footwear: limit, trousers: limit, outer: limit };
}

function parseTripBrief(context, lookCount) {
  return {
    occasions: parseOccasions(context, lookCount),
    packing: parsePackingLimits(context),
    cold: contextNeedsColdLayer(context),
  };
}

/**
 * Whether this look's occasion/context implies cool outdoor walking that needs
 * a warm mid-layer under outerwear. Indoor theatre / dress-up looks are exempt.
 * Multi-slot briefs: outdoor cue must sit on THIS look's body — do not bleed
 * a day-1 city walk onto evening dress-up or breakfast/train-home slots.
 */
function lookNeedsWarmInsulation(context, look, index) {
  var full = String(context || "");
  if (!full.trim()) return false;
  var brief = parseTripBrief(full, null);
  var occ = occasionForLook(brief, look, index);
  var occBody = occ && occ.body ? String(occ.body) : "";
  var multiSlot = (brief.occasions || []).length > 1;
  var focus = occBody || full;

  if (contextImpliesIndoorDressup(focus)) return false;

  // Cool signal only (temp / autumn / cold) — bare "outdoors"/"garden" is not enough.
  // Shared trip weather (e.g. 10°C in the preamble) may apply across outdoor slots.
  var cool =
    contextHasCoolWeather(full) || contextHasCoolWeather(occBody);
  if (!cool) return false;

  if (multiSlot && occBody) {
    return contextImpliesOutdoorActivity(occBody);
  }

  if (occBody) {
    return (
      contextImpliesOutdoorActivity(occBody) ||
      contextImpliesOutdoorActivity(full)
    );
  }

  // Single-context blob: need an outdoor activity cue alongside cool weather.
  return contextImpliesOutdoorActivity(full);
}

function occasionForLook(brief, look, index) {
  var list = (brief && brief.occasions) || [];
  if (!list.length) return null;
  var idx =
    index != null
      ? index
      : Math.max(0, (parseInt(String((look && look.lookId) || "1"), 10) || 1) - 1);
  if (idx >= list.length) return null;
  return list[idx];
}

/** Structured occasion cue — never raw/truncated session context. */
function contextCue(context, occasion) {
  if (occasion && occasion.shortTitle) return occasion.shortTitle;
  if (occasion && occasion.label) return occasion.label;
  var brief = parseTripBrief(context, null);
  if (brief.occasions.length === 1) return brief.occasions[0].shortTitle;
  if (contextNeedsColdLayer(context)) return "Cool outdoor";
  return "";
}

function publicOccasions(brief) {
  return ((brief && brief.occasions) || []).map(function (o) {
    return {
      day: o.day != null ? o.day : null,
      label: o.label || "",
      shortTitle: o.shortTitle || "",
      formalityHint: o.formalityHint || "",
    };
  });
}

function softFormalityMismatches(looks, brief, byId) {
  var mismatches = [];
  var occasions = (brief && brief.occasions) || [];
  for (var i = 0; i < (looks || []).length; i++) {
    var occ = occasions[i];
    if (!occ || !occ.formalityHint) continue;
    var want = formalityRank(occ.formalityHint);
    if (!want) continue;
    var ids = lookItemIds(looks[i]);
    var ranks = [];
    for (var j = 0; j < ids.length; j++) {
      var rec = byId.get(ids[j]);
      var slot = classifySlot(rec || {});
      if (slot === "base" || slot === "trousers" || slot === "outer" || slot === "footwear") {
        ranks.push(formalityRank(rec && rec.formality));
      }
    }
    if (!ranks.length) continue;
    var avg =
      ranks.reduce(function (a, b) {
        return a + b;
      }, 0) / ranks.length;
    // Soft: board/business look averaging below smart-casual is a miss.
    if (want >= formalityRank("business") && avg < formalityRank("smart casual")) {
      mismatches.push({
        lookId: looks[i] && looks[i].lookId,
        want: occ.formalityHint,
        avg: Math.round(avg * 10) / 10,
      });
    }
  }
  if (mismatches.length) {
    console.warn(
      JSON.stringify({
        event: "suggest_formality_soft_mismatch",
        mismatches: mismatches,
      })
    );
  }
  return mismatches;
}

function tripBriefPromptNote(brief) {
  if (!brief) return "";
  var parts = [];
  if (brief.occasions && brief.occasions.length) {
    parts.push(
      "One look per occasion in order: " +
        brief.occasions
          .map(function (o, i) {
            return (
              "look " +
              (i + 1) +
              " = " +
              o.shortTitle +
              (o.formalityHint ? " (" + o.formalityHint + ")" : "")
            );
          })
          .join("; ") +
        ". Put that day/occasion in the title and the first rationale sentence."
    );
  }
  if (brief.cold) {
    parts.push(
      "For cool outdoor / walking days, prefer a warm knit mid-layer (sweater/turtleneck/fleece/flannel) under outerwear — not a polo or tee alone under a jacket. Indoor theatre/dress-up looks need not force that mid-layer."
    );
  }
  if (brief.packing) {
    parts.push(
      "Plan a shared luggage capsule first, then build looks from it. Across all looks use at most " +
        brief.packing.footwear +
        " unique footwear, " +
        brief.packing.trousers +
        " unique trousers/bottoms, and " +
        brief.packing.outer +
        " unique jackets/outers — reuse pieces across days when needed."
    );
  }
  return parts.join(" ");
}

function resolveEngine(body) {
  var requested =
    (body && body.engine) || process.env.SUGGEST_ENGINE || "random";
  return String(requested).trim().toLowerCase() || "random";
}

/**
 * Resolve free-text context from the Suggest body (`context` only).
 * Legacy occasion/weather shim removed once SPA + Lambdas used context.
 */
function resolveContext(body) {
  return clampText(body && body.context, MAX_CONTEXT);
}

/**
 * Normalize Suggest-again soft-exclude item IDs from the request body.
 * Accepts `excludeItemIds` (preferred) or nested look `itemIds` arrays.
 * Dedupes, stringifies, drops empties, clamps to MAX_EXCLUDE_ITEM_IDS.
 */
function resolveExcludeItemIds(body) {
  var raw = [];
  if (body && Array.isArray(body.excludeItemIds)) {
    raw = body.excludeItemIds;
  } else if (body && Array.isArray(body.priorItemIds)) {
    raw = body.priorItemIds;
  } else if (body && Array.isArray(body.looks)) {
    for (var i = 0; i < body.looks.length; i++) {
      var look = body.looks[i] || {};
      var ids = Array.isArray(look.itemIds) ? look.itemIds : [];
      for (var j = 0; j < ids.length; j++) raw.push(ids[j]);
    }
  }
  var out = [];
  var seen = Object.create(null);
  for (var k = 0; k < raw.length; k++) {
    var id = String(raw[k] || "").trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(id);
    if (out.length >= MAX_EXCLUDE_ITEM_IDS) break;
  }
  return out;
}

/** Optional previous suggestion UUID (logging / client continuity; not required). */
function resolvePreviousSuggestionId(body) {
  var id = body && body.previousSuggestionId;
  if (id == null || id === "") id = body && body.suggestionId;
  return clampText(id, 64);
}

/**
 * Strong diversify clause for Suggest-again when prior look itemIds are present.
 */
function diversifyExcludePromptNote(excludeItemIds) {
  var ids = Array.isArray(excludeItemIds) ? excludeItemIds : [];
  if (!ids.length) return "";
  return (
    "Suggest-again diversity (soft-exclude): the user already saw looks using these itemIds: " +
    JSON.stringify(ids) +
    ". Prefer alternate closet pieces in every slot when formality-capable alternatives exist. " +
    "Do not rebuild the same capsule unless packing limits or catalog completeness force reuse. " +
    "Prioritize unused formal/business peers over repeating the exact prior blazer/trousers/shirt/tie set."
  );
}

/**
 * Compact catalog rows for the Bedrock prompt — attrs + aiContext only.
 * Color signal is primary Wada English name (+ id) when set; no free-text color.
 * Never include photos, URLs, keys, base64, or combination IDs.
 */

exports.buildOccasionMeta = buildOccasionMeta;
exports.clampLookCount = clampLookCount;
exports.clampText = clampText;
exports.contextCue = contextCue;
exports.extractLookCount = extractLookCount;
exports.formalityHintFromText = formalityHintFromText;
exports.inferOccasionFromText = inferOccasionFromText;
exports.maxTokensForLookCount = maxTokensForLookCount;
exports.occasionForLook = occasionForLook;
exports.parseCountToken = parseCountToken;
exports.parseOccasions = parseOccasions;
exports.parsePackingLimits = parsePackingLimits;
exports.parseTripBrief = parseTripBrief;
exports.lookNeedsWarmInsulation = lookNeedsWarmInsulation;
exports.publicOccasions = publicOccasions;
exports.resolveContext = resolveContext;
exports.resolveEngine = resolveEngine;
exports.resolveExcludeItemIds = resolveExcludeItemIds;
exports.resolvePreviousSuggestionId = resolvePreviousSuggestionId;
exports.diversifyExcludePromptNote = diversifyExcludePromptNote;
exports.shortTitleFromOccasionBody = shortTitleFromOccasionBody;
exports.softFormalityMismatches = softFormalityMismatches;
exports.tripBriefPromptNote = tripBriefPromptNote;
