"use strict";

var core = require("./core");
var brief = require("./brief");
var copy = require("./copy");
var itemPrimaryWadaName = copy.itemPrimaryWadaName;
var syncLooksCopy = copy.syncLooksCopy;
function getAssemble() { return require("./assemble"); }

var BELT_ITEM_RE = core.BELT_ITEM_RE;
var BROKEN_COPY_RE = core.BROKEN_COPY_RE;
var COLD_OUTDOOR_RE = core.COLD_OUTDOOR_RE;
var COLOR_WORD_RE = core.COLOR_WORD_RE;
var OPEN_LAYER_KNIT_RE = core.OPEN_LAYER_KNIT_RE;
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
var contextAllowsBlackSuitBlackTie = core.contextAllowsBlackSuitBlackTie;
var deps = core.deps;
var formalityRank = core.formalityRank;
var isOpenLayerKnitwear = core.isOpenLayerKnitwear;
var isUniqueSlot = core.isUniqueSlot;
var itemRoleTypeText = core.itemRoleTypeText;
var itemSearchText = core.itemSearchText;
var lookTargetFormality = core.lookTargetFormality;
var modelId = core.modelId;
var nowMs = core.nowMs;
var resetDepsForTests = core.resetDepsForTests;
var slotDefById = core.slotDefById;
var contextNeedsColdLayer = core.contextNeedsColdLayer;
var lookItemIds = core.lookItemIds;
var catalogById = core.catalogById;
var parseJsonObject = core.parseJsonObject;
var itemPrimaryWadaName = core.itemPrimaryWadaName;
var buildOccasionMeta = brief.buildOccasionMeta;
var clampLookCount = brief.clampLookCount;
var clampText = brief.clampText;
var contextCue = brief.contextCue;
var extractLookCount = brief.extractLookCount;
var formalityHintFromText = brief.formalityHintFromText;
var inferOccasionFromText = brief.inferOccasionFromText;
var maxTokensForLookCount = brief.maxTokensForLookCount;
var occasionForLook = brief.occasionForLook;
var parseCountToken = brief.parseCountToken;
var parseOccasions = brief.parseOccasions;
var parsePackingLimits = brief.parsePackingLimits;
var parseTripBrief = brief.parseTripBrief;
var publicOccasions = brief.publicOccasions;
var resolveContext = brief.resolveContext;
var resolveEngine = brief.resolveEngine;
var shortTitleFromOccasionBody = brief.shortTitleFromOccasionBody;
var softFormalityMismatches = brief.softFormalityMismatches;
var tripBriefPromptNote = brief.tripBriefPromptNote;
function catalogHasSlot(catalog, slotId) {
  for (var i = 0; i < (catalog || []).length; i++) {
    if (classifySlot(catalog[i]) === slotId) return true;
  }
  return false;
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

/** Closed base suitable under a cardigan (shirt/tee/polo/sweater — not open knit). */
function isUnderLayerBase(item) {
  if (!item || isOpenLayerKnitwear(item)) return false;
  if (classifySlot(item) === "base") return true;
  var text = itemRoleTypeText(item).toLowerCase();
  return (
    /\b(shirt|tee|t-shirt|polo|oxford|blouse|turtleneck|sweater)\b/.test(text) &&
    !OPEN_LAYER_KNIT_RE.test(text)
  );
}

function lookHasOpenLayerKnit(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    if (isOpenLayerKnitwear(byId.get(ids[i]) || {})) return true;
  }
  return false;
}

function lookHasUnderLayerBase(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    if (isUnderLayerBase(byId.get(ids[i]) || {})) return true;
  }
  return false;
}

function itemLooksBlack(item) {
  if (!item) return false;
  var wada = String(itemPrimaryWadaName(item) || "").toLowerCase();
  if (/\bblack\b/.test(wada)) return true;
  var blob = itemColorBlob(item).toLowerCase();
  var m = blob.match(COLOR_WORD_RE);
  return Boolean(m && String(m[1] || "").toLowerCase() === "black");
}

function isSuitJacketLike(item) {
  var text = itemRoleTypeText(item).toLowerCase();
  if (/\b(leather|denim|bomber|field|field\s*jacket|harrington|biker)\b/.test(text)) {
    return false;
  }
  return (
    /\bblazer\b/.test(text) ||
    /\bsuit\s*jacket\b/.test(text) ||
    (/\bjacket\b/.test(text) && /\bsuit\b/.test(text))
  );
}

function isBlackNecktie(item) {
  if (!item || classifySlot(item) !== "neckwear") return false;
  var text = itemRoleTypeText(item).toLowerCase();
  if (!/\btie\b/.test(text)) return false;
  return itemLooksBlack(item);
}

/**
 * Black blazer/suit jacket + black trousers + black necktie (funeral-only pairing).
 */
function lookHasBlackSuitBlackTie(ids, byId) {
  var blackSuitJacket = false;
  var blackTrousers = false;
  var blackTie = false;
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (!record) continue;
    var slot = classifySlot(record);
    if (slot === "outer" && isSuitJacketLike(record) && itemLooksBlack(record)) {
      blackSuitJacket = true;
    }
    if (slot === "trousers" && itemLooksBlack(record)) {
      blackTrousers = true;
    }
    if (isBlackNecktie(record)) {
      blackTie = true;
    }
  }
  return blackSuitJacket && blackTrousers && blackTie;
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

function itemColorBlob(item) {
  return [
    itemPrimaryWadaName(item),
    item && item.fabric,
    item && item.aiContext,
    item && item.type,
    item && item.brandModel,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Leather / colour family for belt↔footwear matching (empty when unknown). */
function leatherToneFamily(item) {
  var blob = itemColorBlob(item);
  var m = blob.match(COLOR_WORD_RE);
  if (!m) return "";
  var key = String(m[1] || "").toLowerCase();
  return LEATHER_TONE_FAMILIES[key] || "";
}

/**
 * Higher is better. Unknown tones score neutral (1); same family 10; mismatch 0.
 */
function beltFootwearMatchScore(belt, footwear) {
  var beltTone = leatherToneFamily(belt);
  var shoeTone = leatherToneFamily(footwear);
  if (!beltTone || !shoeTone) return 1;
  if (beltTone === shoeTone) return 10;
  return 0;
}

function findLookFootwear(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (classifySlot(record || {}) === "footwear") return record;
  }
  return null;
}

function findLookBelt(ids, byId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var record = byId.get(ids[i]);
    if (record && isBeltItem(record)) return record;
  }
  return null;
}

function uniqueIdsForSlot(looks, byId, slotId) {
  var seen = {};
  var out = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var ids = lookItemIds(looks[i]);
    for (var j = 0; j < ids.length; j++) {
      var rec = byId.get(ids[j]);
      if (classifySlot(rec || {}) !== slotId) continue;
      var id = String(ids[j]);
      if (seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
  }
  return out;
}

function packingSummary(looks, byId) {
  return {
    footwear: uniqueIdsForSlot(looks, byId, "footwear"),
    trousers: uniqueIdsForSlot(looks, byId, "trousers"),
    outer: uniqueIdsForSlot(looks, byId, "outer"),
  };
}

function findSlotIdInLook(ids, byId, slotId) {
  for (var i = 0; i < (ids || []).length; i++) {
    var rec = byId.get(ids[i]);
    if (classifySlot(rec || {}) === slotId) return String(ids[i]);
  }
  return null;
}

function bestCapsuleSubstitute(capsuleIds, byId, targetId, slotId) {
  var target = byId.get(targetId);
  var targetRank = formalityRank(target && target.formality);
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < (capsuleIds || []).length; i++) {
    var id = capsuleIds[i];
    if (id === targetId) return id;
    var rec = byId.get(id);
    if (classifySlot(rec || {}) !== slotId) continue;
    var score = 10 - Math.abs(formalityRank(rec && rec.formality) - targetRank);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Hard cross-look packing repair: when unique footwear/trousers/outer exceed
 * limits, reuse capsule pieces from earlier looks (prefer formality match).
 */
function repairCrossLookPacking(looks, byId, limits) {
  if (!limits) {
    return { looks: looks || [], repairs: 0, packing: packingSummary(looks, byId) };
  }
  var slots = ["footwear", "trousers", "outer"];
  var capsule = {};
  var repairs = 0;
  var nextLooks = (looks || []).map(function (look) {
    return Object.assign({}, look, { itemIds: lookItemIds(look).slice() });
  });

  for (var s = 0; s < slots.length; s++) {
    var slotId = slots[s];
    var maxN = limits[slotId];
    if (!(maxN > 0)) continue;
    var uniques = uniqueIdsForSlot(nextLooks, byId, slotId);
    capsule[slotId] = uniques.slice(0, maxN);
    if (uniques.length <= maxN) continue;

    for (var li = 0; li < nextLooks.length; li++) {
      var ids = nextLooks[li].itemIds;
      var current = findSlotIdInLook(ids, byId, slotId);
      if (!current) continue;
      if (capsule[slotId].indexOf(current) >= 0) continue;
      var sub = bestCapsuleSubstitute(capsule[slotId], byId, current, slotId);
      if (!sub || sub === current) continue;
      for (var k = 0; k < ids.length; k++) {
        if (String(ids[k]) === current) {
          ids[k] = sub;
          repairs += 1;
          console.warn(
            JSON.stringify({
              event: "suggest_packing_repair",
              lookId: nextLooks[li].lookId,
              slot: slotId,
              from: current,
              to: sub,
            })
          );
          break;
        }
      }
      nextLooks[li].itemIds = ids;
    }
  }

  // Restore items arrays when callers used items-only shape.
  for (var i = 0; i < nextLooks.length; i++) {
    var look = nextLooks[i];
    if (look.items && !looks[i].itemIds) {
      look.items = look.itemIds
        .map(function (id) {
          return byId.get(id);
        })
        .filter(Boolean);
      delete look.itemIds;
    }
  }

  return {
    looks: nextLooks,
    repairs: repairs,
    packing: packingSummary(nextLooks, byId),
  };
}

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
  // Cardigan / open knit mid-layer without a shirt/tee (or equivalent) underneath.
  if (
    lookHasOpenLayerKnit(itemIds, byId) &&
    !lookHasUnderLayerBase(itemIds, byId)
  ) {
    reasons.push("missing_base_under_open_knit");
  }
  // Black suit + black necktie — hard reject unless funeral/mourning context.
  if (
    !opts.allowBlackSuitBlackTie &&
    lookHasBlackSuitBlackTie(itemIds, byId)
  ) {
    reasons.push("black_suit_black_tie");
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
    allowBlackSuitBlackTie: contextAllowsBlackSuitBlackTie(context),
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
  var footwear = findLookFootwear(ids, byId);
  var belts = [];
  for (var i = 0; i < (catalog || []).length; i++) {
    if (isBeltItem(catalog[i])) belts.push(catalog[i]);
  }
  belts.sort(function (a, b) {
    var aFresh = usedIds.has(String(a.itemId)) ? 1 : 0;
    var bFresh = usedIds.has(String(b.itemId)) ? 1 : 0;
    if (aFresh !== bFresh) return aFresh - bFresh;
    if (footwear) {
      var aTone = beltFootwearMatchScore(a, footwear);
      var bTone = beltFootwearMatchScore(b, footwear);
      if (aTone !== bTone) return bTone - aTone;
    }
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
 * Hard belt ↔ footwear leather-tone repair. Prefer a better-matching belt from
 * the closet unused in this look; drop belt only when trousers do not need a
 * waist finish (existing side-adjuster / beltless rules).
 */
function repairBeltFootwearMatch(looks, byId, catalog) {
  var repairs = 0;
  var nextLooks = (looks || []).map(function (look) {
    return Object.assign({}, look, { itemIds: lookItemIds(look).slice() });
  });

  for (var li = 0; li < nextLooks.length; li++) {
    var ids = nextLooks[li].itemIds;
    var footwear = findLookFootwear(ids, byId);
    var belt = findLookBelt(ids, byId);
    if (!footwear || !belt) continue;
    var currentScore = beltFootwearMatchScore(belt, footwear);
    if (currentScore >= 10) continue;

    var usedInLook = {};
    for (var u = 0; u < ids.length; u++) usedInLook[String(ids[u])] = true;

    var best = null;
    var bestScore = currentScore;
    for (var c = 0; c < (catalog || []).length; c++) {
      var candidate = catalog[c];
      if (!candidate || !candidate.itemId || !isBeltItem(candidate)) continue;
      var cid = String(candidate.itemId);
      if (usedInLook[cid]) continue;
      var score = beltFootwearMatchScore(candidate, footwear);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best && bestScore > currentScore) {
      var fromId = String(belt.itemId);
      var toId = String(best.itemId);
      for (var k = 0; k < ids.length; k++) {
        if (String(ids[k]) === fromId) {
          ids[k] = toId;
          repairs += 1;
          console.warn(
            JSON.stringify({
              event: "suggest_belt_footwear_repair",
              lookId: nextLooks[li].lookId,
              action: "swap",
              from: fromId,
              to: toId,
              shoeTone: leatherToneFamily(footwear),
              beltTone: leatherToneFamily(best),
            })
          );
          break;
        }
      }
      nextLooks[li].itemIds = ids;
      continue;
    }

    if (currentScore > 0) continue;
    var trousers = findLookTrousers(ids, byId);
    if (trousers && trousersNeedWaistFinish(trousers)) continue;
    var dropId = String(belt.itemId);
    nextLooks[li].itemIds = ids.filter(function (id) {
      return String(id) !== dropId;
    });
    repairs += 1;
    console.warn(
      JSON.stringify({
        event: "suggest_belt_footwear_repair",
        lookId: nextLooks[li].lookId,
        action: "drop",
        from: dropId,
        shoeTone: leatherToneFamily(footwear),
        beltTone: leatherToneFamily(belt),
      })
    );
  }

  for (var i = 0; i < nextLooks.length; i++) {
    var look = nextLooks[i];
    if (look.items && !looks[i].itemIds) {
      look.items = look.itemIds
        .map(function (id) {
          return byId.get(id);
        })
        .filter(Boolean);
      delete look.itemIds;
    }
  }

  return { looks: nextLooks, repairs: repairs };
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

  if (
    result.reasons.indexOf("missing_base") >= 0 ||
    result.reasons.indexOf("missing_base_under_open_knit") >= 0
  ) {
    attach(function (item) {
      return isUnderLayerBase(item);
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
  if (result.reasons.indexOf("black_suit_black_tie") >= 0) {
    var swapped = false;
    var nonBlackTie = pickUnusedCandidate(catalog, used, function (item) {
      return (
        classifySlot(item) === "neckwear" &&
        /\btie\b/i.test(itemRoleTypeText(item)) &&
        !itemLooksBlack(item)
      );
    });
    var nextIds = [];
    for (var ti = 0; ti < ids.length; ti++) {
      var tieRec = byId.get(ids[ti]);
      if (isBlackNecktie(tieRec || {})) {
        if (nonBlackTie && !swapped) {
          nextIds.push(String(nonBlackTie.itemId));
          used.add(String(nonBlackTie.itemId));
          swapped = true;
          repairs.push("swap_black_suit_tie");
        } else {
          repairs.push("drop_black_suit_tie");
        }
        continue;
      }
      nextIds.push(ids[ti]);
    }
    ids = nextIds;
    console.warn(
      JSON.stringify({
        event: "suggest_black_suit_black_tie_repair",
        lookId: look.lookId,
        action: swapped ? "swap" : "drop",
      })
    );
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
  var generated = getAssemble().assembleRandomLooks(leftoverCatalog, {
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


function softStyleClashes(looks, byId, context) {
  var clashes = [];
  for (var i = 0; i < (looks || []).length; i++) {
    var ids = lookItemIds(looks[i]);
    if (lookHasBlackSuitBlackTie(ids, byId)) {
      clashes.push({
        lookId: looks[i] && looks[i].lookId,
        rule: "black_suit_black_tie",
        allowed: contextAllowsBlackSuitBlackTie(context),
      });
    }
  }
  if (clashes.length) {
    console.warn(
      JSON.stringify({
        event: "suggest_style_soft_clash",
        clashes: clashes,
      })
    );
  }
  return clashes;
}

exports.assertLooksComplete = assertLooksComplete;
exports.backfillLooksDeterministic = backfillLooksDeterministic;
exports.beltFootwearMatchScore = beltFootwearMatchScore;
exports.bestCapsuleSubstitute = bestCapsuleSubstitute;
exports.catalogHasBelt = catalogHasBelt;
exports.catalogHasFootwear = catalogHasFootwear;
exports.catalogHasSlot = catalogHasSlot;
exports.catalogHasSuspenders = catalogHasSuspenders;
exports.completenessOptionsForLook = completenessOptionsForLook;
exports.enforceSlotUniqueness = enforceSlotUniqueness;
exports.filterCompleteLooks = filterCompleteLooks;
exports.filterRandomLooksComplete = filterRandomLooksComplete;
exports.findLookBelt = findLookBelt;
exports.findLookFootwear = findLookFootwear;
exports.findLookTrousers = findLookTrousers;
exports.findSlotIdInLook = findSlotIdInLook;
exports.footwearFormality = footwearFormality;
exports.isBeltItem = isBeltItem;
exports.isBlackNecktie = isBlackNecktie;
exports.isOpenLayerKnitwear = isOpenLayerKnitwear;
exports.isSuitJacketLike = isSuitJacketLike;
exports.isSuspendersItem = isSuspendersItem;
exports.isUnderLayerBase = isUnderLayerBase;
exports.itemColorBlob = itemColorBlob;
exports.itemLooksBlack = itemLooksBlack;
exports.leatherToneFamily = leatherToneFamily;
exports.lookCompleteness = lookCompleteness;
exports.lookHasBlackSuitBlackTie = lookHasBlackSuitBlackTie;
exports.lookHasOpenLayerKnit = lookHasOpenLayerKnit;
exports.lookHasOuterLayer = lookHasOuterLayer;
exports.lookHasUnderLayerBase = lookHasUnderLayerBase;
exports.lookHasWaistFinish = lookHasWaistFinish;
exports.softStyleClashes = softStyleClashes;
exports.packingSummary = packingSummary;
exports.pickUnusedCandidate = pickUnusedCandidate;
exports.pickWaistFinish = pickWaistFinish;
exports.repairBeltFootwearMatch = repairBeltFootwearMatch;
exports.repairCrossLookPacking = repairCrossLookPacking;
exports.repairLookLocally = repairLookLocally;
exports.repairLooksLocally = repairLooksLocally;
exports.salvageCompetingBases = salvageCompetingBases;
exports.trousersNeedWaistFinish = trousersNeedWaistFinish;
exports.trousersSuspenderCapable = trousersSuspenderCapable;
exports.uniqueIdsForSlot = uniqueIdsForSlot;
exports.usedIdsFromLooks = usedIdsFromLooks;
