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
 * Structured day/occasion list from multi-day briefs (Day 1: … Day 2: …).
 * Soft formality hints for board vs casual/train vs dinner.
 */
function parseOccasions(context, lookCount) {
  var text = String(context || "").replace(/\s+/g, " ").trim();
  var occasions = [];
  if (!text) return occasions;
  var re =
    /Day\s*(\d+)\s*:\s*(.+?)(?=(?:\s*[-–•]?\s*)Day\s*\d+\s*:|$)/gi;
  var match;
  while ((match = re.exec(text)) !== null) {
    var body = String(match[2] || "")
      .replace(/^[-–•]\s*/, "")
      .replace(/\s*[-–]\s*$/, "")
      .trim();
    if (!body) continue;
    occasions.push(buildOccasionMeta(Number(match[1]), body));
  }
  occasions.sort(function (a, b) {
    return a.day - b.day;
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
  // Highest first so black-tie / gala subsetting does not collapse to business.
  if (/\b(black\s*-?\s*tie|white\s*-?\s*tie|opera|gala)\b/.test(t)) {
    return "black tie";
  }
  if (/\bformal\b/.test(t)) return "formal";
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
  if (/\btrain\b/.test(t) && /\bdinner\b/.test(t)) return "Train-to-dinner";
  if (/\bcasual\b/.test(t) && /\btrain\b/.test(t)) return "Casual train";
  if (/\bdinner\b/.test(t) && /\b(client|colleague)/.test(t)) {
    return "Client dinner";
  }
  if (/\bgarden\b|\bpatio\b|\bterrace\b/.test(t)) return "Garden evening";
  if (/\bdinner\b/.test(t)) return "Dinner look";
  if (/\blunch\b/.test(t)) return "Lunch look";
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
  if (
    !/\b(board|dinner|lunch|garden|patio|train|travel|casual|client|evening|office)\b/i.test(
      t
    )
  ) {
    return null;
  }
  return buildOccasionMeta(day || null, t.slice(0, 160));
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
 */
function lookNeedsWarmInsulation(context, look, index) {
  var full = String(context || "");
  if (!full.trim()) return false;
  var brief = parseTripBrief(full, null);
  var occ = occasionForLook(brief, look, index);
  var occBody = occ && occ.body ? String(occ.body) : "";
  var focus = occBody || full;

  if (contextImpliesIndoorDressup(focus)) return false;

  // Cool signal only (temp / autumn / cold) — bare "outdoors"/"garden" is not enough.
  var cool =
    contextHasCoolWeather(full) || contextHasCoolWeather(occBody);
  if (!cool) return false;

  if (occBody) {
    // Named day: outdoor cue on that day, or outdoor in the shared brief.
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
exports.shortTitleFromOccasionBody = shortTitleFromOccasionBody;
exports.softFormalityMismatches = softFormalityMismatches;
exports.tripBriefPromptNote = tripBriefPromptNote;
