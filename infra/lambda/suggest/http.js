"use strict";

var crypto = require("crypto");
var items = require("../items");
var core = require("./core");
var brief = require("./brief");
var copy = require("./copy");
var repair = require("./repair");
var assemble = require("./assemble");

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
var assembleRandomLooks = assemble.assembleRandomLooks;
var assembleWithBedrock = assemble.assembleWithBedrock;
var bucketBySlot = assemble.bucketBySlot;
var catalogIdSet = assemble.catalogIdSet;
var completenessRepairNote = assemble.completenessRepairNote;
var invokeBedrock = assemble.invokeBedrock;
var invokeBedrockWithRetry = assemble.invokeBedrockWithRetry;
var schemaExample = assemble.schemaExample;
var serializeCatalogForPrompt = assemble.serializeCatalogForPrompt;
var shuffleInPlace = assemble.shuffleInPlace;
var sleep = assemble.sleep;
var softWadaPriorText = assemble.softWadaPriorText;
var systemPrompt = assemble.systemPrompt;
var userPrompt = assemble.userPrompt;
var validateLookPayload = assemble.validateLookPayload;
async function enrichLookItems(records) {
  return Promise.all(
    (records || []).map(async function (record) {
      var signed = await Promise.all([
        items.signedFullUrls(record),
        items.signedThumbUrls(record),
        items.signedCutoutUrls(record),
      ]);
      return items.publicItem(record, signed[0], signed[1], signed[2]);
    })
  );
}

function catalogCapMeta(catalog) {
  var total = (catalog || []).length;
  var capped = total > SOFT_CATALOG_CAP;
  return {
    catalogCapped: capped,
    catalogTotal: total,
    catalogUsed: capped ? SOFT_CATALOG_CAP : total,
  };
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
        packing: assembled.packing || null,
        packingLimits: assembled.packingLimits || null,
        occasions: assembled.occasions || null,
      };
      countMeta.requestedLookCount = assembled.requestedLookCount;
      countMeta.returnedLookCount = assembled.returnedLookCount;
      countMeta.lookCountShortfall = Boolean(assembled.lookCountShortfall);
    }
  } else {
    throw Object.assign(new Error("unknown_suggest_engine"), { statusCode: 400 });
  }

  var capMeta = catalogCapMeta(catalog);
  var looks = await Promise.all(
    rawLooks.map(async function (raw, i) {
      return {
        lookId: raw.lookId || String(i + 1),
        title: clampTitle(raw.title),
        rationale: clampText(raw.rationale, MAX_RATIONALE),
        items: await enrichLookItems(raw.items || []),
      };
    })
  );

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
        packingRepairs:
          bedrockMeta.repairCounts && bedrockMeta.repairCounts.packing,
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
  if (capMeta.catalogCapped) {
    responseBody.catalogCapped = true;
    responseBody.catalogTotal = capMeta.catalogTotal;
    responseBody.catalogUsed = capMeta.catalogUsed;
  }
  if (bedrockMeta && bedrockMeta.modelId) {
    responseBody.modelId = bedrockMeta.modelId;
  }
  if (bedrockMeta && bedrockMeta.packing) {
    responseBody.packing = bedrockMeta.packing;
  }
  if (bedrockMeta && bedrockMeta.packingLimits) {
    responseBody.packingLimits = bedrockMeta.packingLimits;
  }
  if (bedrockMeta && bedrockMeta.occasions) {
    responseBody.occasions = bedrockMeta.occasions;
  }

  return {
    statusCode: 200,
    body: responseBody,
  };
}


exports.catalogCapMeta = catalogCapMeta;
exports.enrichLookItems = enrichLookItems;
exports.suggestLooks = suggestLooks;
