"use strict";

var { ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
var core = require("./core");
var brief = require("./brief");
var copy = require("./copy");
var repair = require("./repair");
var wadaPalette = require("../wadaPalette");
var wadaSoftCombos = require("../wadaSoftCombos.v1.json");

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
var clampTitle = copy.clampTitle;
var colorCueFromItem = copy.colorCueFromItem;
var copyLooksBroken = copy.copyLooksBroken;
var copyLooksFormulaic = copy.copyLooksFormulaic;
var copyMentionsForeignPieces = copy.copyMentionsForeignPieces;
var titleLooksFlat = copy.titleLooksFlat;
var copyRewriteSystemPrompt = copy.copyRewriteSystemPrompt;
var copyRewriteUserPrompt = copy.copyRewriteUserPrompt;
var itemLabel = copy.itemLabel;
var itemMentionTokens = copy.itemMentionTokens;
var lookAnchorPiece = copy.lookAnchorPiece;
var pieceDetail = copy.pieceDetail;
var pieceTypeLabel = copy.pieceTypeLabel;
var rewriteLookCopy = copy.rewriteLookCopy;
var rewriteLooksCopyWithBedrock = copy.rewriteLooksCopyWithBedrock;
var sameIdList = copy.sameIdList;
var shortTypeWord = copy.shortTypeWord;
var significantTokens = copy.significantTokens;
var syncLookCopy = copy.syncLookCopy;
var syncLooksCopy = copy.syncLooksCopy;
var uniqueNonEmpty = copy.uniqueNonEmpty;
var assertLooksComplete = repair.assertLooksComplete;
var backfillLooksDeterministic = repair.backfillLooksDeterministic;
var beltFootwearMatchScore = repair.beltFootwearMatchScore;
var bestCapsuleSubstitute = repair.bestCapsuleSubstitute;
var catalogHasBelt = repair.catalogHasBelt;
var catalogHasFootwear = repair.catalogHasFootwear;
var catalogHasSlot = repair.catalogHasSlot;
var catalogHasSuspenders = repair.catalogHasSuspenders;
var completenessOptionsForLook = repair.completenessOptionsForLook;
var enforceSlotUniqueness = repair.enforceSlotUniqueness;
var filterCompleteLooks = repair.filterCompleteLooks;
var filterRandomLooksComplete = repair.filterRandomLooksComplete;
var findLookBelt = repair.findLookBelt;
var findLookFootwear = repair.findLookFootwear;
var findLookTrousers = repair.findLookTrousers;
var findSlotIdInLook = repair.findSlotIdInLook;
var footwearFormality = repair.footwearFormality;
var isBeltItem = repair.isBeltItem;
var isSuspendersItem = repair.isSuspendersItem;
var itemColorBlob = repair.itemColorBlob;
var leatherToneFamily = repair.leatherToneFamily;
var lookCompleteness = repair.lookCompleteness;
var lookHasOuterLayer = repair.lookHasOuterLayer;
var lookHasWaistFinish = repair.lookHasWaistFinish;
var softStyleClashes = repair.softStyleClashes;
var packingSummary = repair.packingSummary;
var pickUnusedCandidate = repair.pickUnusedCandidate;
var pickWaistFinish = repair.pickWaistFinish;
var repairBeltFootwearMatch = repair.repairBeltFootwearMatch;
var repairCrossLookPacking = repair.repairCrossLookPacking;
var repairLookLocally = repair.repairLookLocally;
var repairLooksLocally = repair.repairLooksLocally;
var salvageCompetingBases = repair.salvageCompetingBases;
var trousersNeedWaistFinish = repair.trousersNeedWaistFinish;
var trousersSuspenderCapable = repair.trousersSuspenderCapable;
var uniqueIdsForSlot = repair.uniqueIdsForSlot;
var usedIdsFromLooks = repair.usedIdsFromLooks;
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

/**
 * Target formality rank from Suggest context (multi-day max, else keyword hint).
 * Incomplete / unknown context → 0 (attrs-complete fallback only).
 */
function targetFormalityRankFromContext(context) {
  var text = String(context || "");
  if (!text.trim()) return 0;
  var brief = parseTripBrief(text, null);
  var best = 0;
  var occasions = (brief && brief.occasions) || [];
  for (var i = 0; i < occasions.length; i++) {
    best = Math.max(best, formalityRank(occasions[i].formalityHint));
  }
  if (!best) best = formalityRank(formalityHintFromText(text));
  return best;
}

/**
 * Score a catalog row for soft-cap subsetting. Higher = keep in prompt.
 * Prefer formality near the request; fall back to usable role/slot and
 * attrs presence when formality is missing or context has no hint.
 */
function catalogSubsetScore(row, targetRank) {
  var item = row || {};
  var rawFormality = String(item.formality || "").trim();
  var fRank = formalityRank(rawFormality);
  // Treat hyphenated / unknown seed peers via rank; empty stays incomplete.
  var hasFormality = Boolean(rawFormality);
  var hasRole = Boolean(String(item.outfitRole || "").trim());
  // classifySlot already matches outfitRole first, then type — fills seed gaps.
  var slot = classifySlot(item);
  var usableRole = hasRole || Boolean(slot);

  var score = 0;
  if (usableRole) score += 10;
  if (hasFormality) score += 5;
  if (
    slot === "base" ||
    slot === "trousers" ||
    slot === "footwear" ||
    slot === "outer"
  ) {
    score += 3;
  }

  if (targetRank > 0) {
    if (fRank > 0) {
      var distance = Math.abs(fRank - targetRank);
      score += Math.max(0, 24 - distance * 7);
      if (targetRank >= 3 && fRank >= targetRank - 1) score += 8;
      // Formal / business asks: demote clearly casual inventory.
      if (targetRank >= 3 && fRank <= 1) score -= 18;
      if (targetRank >= 4 && fRank > 0 && fRank <= 2) score -= 10;
    } else if (!usableRole) {
      // No formality and no role/slot — last resort under a formality ask.
      score -= 40;
    } else {
      // Incomplete formality but usable role/slot — mild demotion.
      score -= 3;
    }
  }

  return score;
}

/**
 * When closet exceeds SOFT_CATALOG_CAP, keep the highest-scoring rows for this
 * request (formality/role). Stable oldest-first tie-break among equals.
 */
function selectCatalogForPrompt(catalog, context) {
  var rows = (catalog || []).slice();
  if (rows.length <= SOFT_CATALOG_CAP) return rows;
  var targetRank = targetFormalityRankFromContext(context);
  rows.sort(function (a, b) {
    var diff = catalogSubsetScore(b, targetRank) - catalogSubsetScore(a, targetRank);
    if (diff !== 0) return diff;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  return rows.slice(0, SOFT_CATALOG_CAP);
}

/** Strip markdown/quotes from model titles; clamp ≤ MAX_TITLE. */
function serializeCatalogForPrompt(catalog, context) {
  var rows = selectCatalogForPrompt(catalog, context);

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
    "Cardigan / open knit mid-layer: always include a shirt, tee, polo, or equivalent closed base underneath — never ship a cardigan as the sole top.",
    "Never pair a black suit (black blazer/suit jacket + black trousers) with a black necktie unless the context clearly is a funeral or mourning. For theatre / dress-up / dinner, prefer a coloured or textured tie, or no tie with dress shirt + blazer.",
    "When context is cold / cool / outdoor evening / garden / patio, include a warm outer or mid layer when the catalog has candidates.",
    "Cool outdoor walking (≤~14°C, autumn/fall, chilly city walk / explore outdoors): prefer a sweater, turtleneck, fleece, or flannel under a jacket/coat — never a polo, tee, or light shirt alone under outerwear. Indoor-only / theatre / dress-up looks are exempt.",
    "When trousers need a waist finish (not side-adjuster/beltless), include a belt — or suspenders/braces when the trousers' aiContext supports them.",
    "Match belt leather tone to footwear (black belt with black shoes; brown/tan/cognac belt with brown shoes). Never pair a brown belt with black shoes when a matching belt exists in the catalog.",
    "Accessories beyond waist finish remain optional — hat, scarf, jewelry, bag, neckwear, etc. Add them when they improve the look or fit the occasion.",
    "Title and rationale must name only pieces present in that look's itemIds (prefer type + Wada/common colour + fabric; brandModel secondary). Never describe a cardigan if the look's outer is a leather jacket.",
    'Titles: catchy thematic phrases with personality (e.g. "Soft power for the board", "Charcoal that travels", "Garden-evening layers", "Client-calm charcoal"). Fit the look\'s vibe; occasion may flavour a title but need not appear in every one. Never flat templates: "{occasion} {color}", "{color} for {occasion}", "{color} {type} that carries {occasion}", "{occasion}-ready {type}", "{adj} {color} {type}, {occasion} cut" — ban "Board day blue", "blue for Dinner look", "black blazer that carries Lunch", "Lunch-ready blazer", "Quiet gray blazer, Lunch cut". Never lead with Wada name + brand. Never paste or truncate session context into titles. Never end mid-phrase.',
    "Rationales: 2–4 sentences with varied voice; first sentence names this look's occasion/day; then why pieces fit that day, materials, and palette. Name pieces as colour + type (+ fabric), with brand only as a tag — e.g. \"black leather jacket (Gipsy)\", never \"Black Gipsy\" / brand-as-noun. Do not paste session context. Do not reuse an anchors/Materials stay honest/Palette-wise skeleton on every look.",
    "When the context lists Day 1 / Day 2 / … or distinct occasions and asks for that many looks, return one look per day/occasion in order with matching formality (board → business; casual train → smart casual).",
    "When luggage/trip limits appear (or a multi-day trip implies packing), plan a shared capsule first and reuse footwear/trousers/jackets across looks so unique counts stay within the stated (or default ≤2) limits.",
    "Never return a look that is only tops, only bottoms, or missing a bottom when trousers/jeans/shorts exist in the catalog.",
    "If the catalog lacks a mandatory slot class (e.g. no footwear at all), omit that slot rather than inventing IDs — still require every available mandatory-core slot.",
    "Diversify across the " +
      count +
      " looks (formality or palette) when the closet allows — except where packing reuse requires repeating capsule pieces.",
    "Schema:",
    JSON.stringify(schemaExample(count)),
  ].join("\n");
}

function userPrompt(context, catalogJson, repairNote, lookCount, brief) {
  var count = clampLookCount(lookCount);
  var trip = brief || parseTripBrief(context, count);
  var parts = [
    "Context: " + context,
    "Catalog JSON:",
    catalogJson,
    "Each look needs mandatory core (base + bottom + footwear when available). Accessories optional for interest — not required.",
  ];
  var tripNote = tripBriefPromptNote(trip);
  if (tripNote) parts.push(tripNote);
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
    " If missing_base_under_open_knit: add a shirt/tee/polo (or equivalent closed base) under the cardigan/open knit." +
    " If black_suit_black_tie: replace the black necktie with a coloured/textured tie, or omit the tie — never black-on-black necktie with a black suit unless the context is funeral/mourning." +
    " If missing_layer_for_cold: add a warm outer/mid layer from the catalog." +
    " If insufficient_insulation_for_cool_outdoor: replace a thin polo/tee/shirt under outerwear with a sweater/turtleneck/fleece/flannel (warm mid-layer) from the catalog — indoor/theatre looks exempt." +
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
  var brief = parseTripBrief(context, lookCount);
  var compact = serializeCatalogForPrompt(catalog, context);
  var allowedIds = catalogIdSet(catalog);
  var byId = catalogById(catalog);
  var catalogJson = JSON.stringify(compact);
  var system = systemPrompt(lookCount);
  var bedrockCalls = 0;
  var inputTokens = 0;
  var outputTokens = 0;
  var lastModelId = modelId();
  var startedAt = nowMs();
  var packingRepairs = 0;

  function withinSecondPassBudget() {
    return nowMs() - startedAt < SECOND_PASS_DEADLINE_MS;
  }

  function canOptionalBedrockPass() {
    return bedrockCalls < 2 && withinSecondPassBudget();
  }

  async function callBedrock(userText, systemOverride) {
    var sys = systemOverride || system;
    var result = await invokeBedrockWithRetry(sys, userText, lookCount);
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
      userPrompt(context, catalogJson, null, lookCount, brief)
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
          lookCount,
          brief
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
          lookCount,
          brief
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
          lookCount,
          brief
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
    context,
    { brief: brief }
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
          missing,
          brief
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
        context,
        { brief: brief }
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

  // P1: hard cross-look packing repair when trip/luggage limits apply.
  var priorBeforePacking = completeLooks.map(lookItemIds);
  var packingResult = repairCrossLookPacking(
    completeLooks,
    byId,
    brief.packing
  );
  packingRepairs = packingResult.repairs || 0;
  completeLooks = packingResult.looks;
  completeLooks = enforceSlotUniqueness(completeLooks, byId);

  // Belt ↔ footwear leather-tone repair after packing (shoes may have swapped).
  var beltResult = repairBeltFootwearMatch(completeLooks, byId, catalog);
  var beltRepairs = beltResult.repairs || 0;
  completeLooks = beltResult.looks;
  completeLooks = enforceSlotUniqueness(completeLooks, byId);
  softFormalityMismatches(completeLooks, brief, byId);
  softStyleClashes(completeLooks, byId, context);

  // Prefer Bedrock copy rewrite after slot/packing/belt repair when budget allows.
  // Template is the true fallback — detect flat/formulaic/broken copy. Do not
  // force a rewrite merely because the title omits the occasion word.
  var localRepairs =
    ((local.repairCounts && local.repairCounts.layer) || 0) +
    ((local.repairCounts && local.repairCounts.waist) || 0) +
    ((local.repairCounts && local.repairCounts.core) || 0);
  var formulaicCopy = completeLooks.some(function (look) {
    return copyLooksFormulaic(look && look.title, look && look.rationale);
  });
  var flatTitles = completeLooks.some(function (look, index) {
    return titleLooksFlat(
      look && look.title,
      occasionForLook(brief, look, index)
    );
  });
  var brokenCopy = completeLooks.some(function (look) {
    return copyLooksBroken(look && look.title, look && look.rationale);
  });
  var needsCopyPass =
    packingRepairs > 0 ||
    beltRepairs > 0 ||
    localRepairs > 0 ||
    formulaicCopy ||
    flatTitles ||
    brokenCopy;
  if (needsCopyPass && canOptionalBedrockPass()) {
    var bedrockCopy = await rewriteLooksCopyWithBedrock(
      completeLooks,
      byId,
      brief,
      callBedrock
    );
    if (bedrockCopy) {
      completeLooks = bedrockCopy;
    } else {
      completeLooks = syncLooksCopy(
        completeLooks,
        priorBeforePacking,
        byId,
        catalog,
        context,
        { brief: brief, force: true }
      );
    }
  } else {
    completeLooks = syncLooksCopy(
      completeLooks,
      priorBeforePacking,
      byId,
      catalog,
      context,
      {
        brief: brief,
        force: packingRepairs > 0 || beltRepairs > 0 || needsCopyPass,
      }
    );
  }

  var packing = packingSummary(completeLooks, byId);

  var shortfall = completeLooks.length < lookCount;
  if (shortfall) {
    console.warn(
      JSON.stringify({
        event: "suggest_look_count_shortfall",
        requestedLookCount: lookCount,
        returnedLookCount: completeLooks.length,
        layerRepairs: local.repairCounts.layer,
        waistRepairs: local.repairCounts.waist,
        packingRepairs: packingRepairs,
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

  var repairCounts = Object.assign({}, local.repairCounts, {
    packing: packingRepairs,
    belt: beltRepairs,
  });
  var occasions = publicOccasions(brief);

  return {
    looks: looks,
    modelId: lastModelId,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    requestedLookCount: lookCount,
    returnedLookCount: looks.length,
    lookCountShortfall: shortfall,
    repairCounts: repairCounts,
    bedrockCalls: bedrockCalls,
    packing: brief.packing ? packing : null,
    packingLimits: brief.packing || null,
    occasions: occasions.length ? occasions : null,
  };
}


exports.assembleRandomLooks = assembleRandomLooks;
exports.assembleWithBedrock = assembleWithBedrock;
exports.bucketBySlot = bucketBySlot;
exports.catalogIdSet = catalogIdSet;
exports.completenessRepairNote = completenessRepairNote;
exports.invokeBedrock = invokeBedrock;
exports.invokeBedrockWithRetry = invokeBedrockWithRetry;
exports.catalogSubsetScore = catalogSubsetScore;
exports.schemaExample = schemaExample;
exports.selectCatalogForPrompt = selectCatalogForPrompt;
exports.serializeCatalogForPrompt = serializeCatalogForPrompt;
exports.shuffleInPlace = shuffleInPlace;
exports.sleep = sleep;
exports.softWadaPriorText = softWadaPriorText;
exports.systemPrompt = systemPrompt;
exports.targetFormalityRankFromContext = targetFormalityRankFromContext;
exports.userPrompt = userPrompt;
exports.validateLookPayload = validateLookPayload;
