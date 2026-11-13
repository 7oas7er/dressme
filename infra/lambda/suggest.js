"use strict";

/**
 * Outfit suggestions (UC-04–06 + UC-09 rationale).
 * Implementation split by job under ./suggest/ (brief, assemble, repair, copy, http).
 */

var core = require("./suggest/core");
var brief = require("./suggest/brief");
var copy = require("./suggest/copy");
var repair = require("./suggest/repair");
var assemble = require("./suggest/assemble");
var http = require("./suggest/http");

function pick(mod) {
  return mod;
}

Object.assign(exports, core, brief, copy, repair, assemble, http);

// Stable public surface (explicit for readability / greppability).
exports.LOOK_COUNT = core.LOOK_COUNT;
exports.DEFAULT_LOOK_COUNT = core.DEFAULT_LOOK_COUNT;
exports.MIN_LOOK_COUNT = core.MIN_LOOK_COUNT;
exports.MAX_LOOK_COUNT = core.MAX_LOOK_COUNT;
exports.MAX_CONTEXT = core.MAX_CONTEXT;
exports.MAX_RATIONALE = core.MAX_RATIONALE;
exports.MAX_TITLE = core.MAX_TITLE;
exports.SLOT_DEFS = core.SLOT_DEFS;
exports.STYLE_PACK_V1 = core.STYLE_PACK_V1;
exports.UNIQUE_SLOTS = core.UNIQUE_SLOTS;
exports.SOFT_CATALOG_CAP = core.SOFT_CATALOG_CAP;
exports.DEFAULT_MODEL_ID = core.DEFAULT_MODEL_ID;
exports.SECOND_PASS_DEADLINE_MS = core.SECOND_PASS_DEADLINE_MS;
exports.formalityRank = core.formalityRank;
exports.classifySlot = core.classifySlot;
exports.isOpenLayerKnitwear = core.isOpenLayerKnitwear;
exports.contextAllowsBlackSuitBlackTie = core.contextAllowsBlackSuitBlackTie;
exports.resetDepsForTests = core.resetDepsForTests;
exports.modelId = core.modelId;
exports.softWadaPriorText = assemble.softWadaPriorText;
exports.extractLookCount = brief.extractLookCount;
exports.clampLookCount = brief.clampLookCount;
exports.resolveContext = brief.resolveContext;
exports.resolveEngine = brief.resolveEngine;
exports.parseOccasions = brief.parseOccasions;
exports.parsePackingLimits = brief.parsePackingLimits;
exports.parseTripBrief = brief.parseTripBrief;
exports.publicOccasions = brief.publicOccasions;
exports.contextCue = brief.contextCue;
exports.clampTitle = copy.clampTitle;
exports.rewriteLookCopy = copy.rewriteLookCopy;
exports.syncLookCopy = copy.syncLookCopy;
exports.syncLooksCopy = copy.syncLooksCopy;
exports.copyMentionsForeignPieces = copy.copyMentionsForeignPieces;
exports.copyLooksBroken = copy.copyLooksBroken;
exports.copyLooksBrandAsNoun = copy.copyLooksBrandAsNoun;
exports.copyLooksFormulaic = copy.copyLooksFormulaic;
exports.itemLabel = copy.itemLabel;
exports.pieceDetail = copy.pieceDetail;
exports.titleLooksFlat = copy.titleLooksFlat;
exports.enforceSlotUniqueness = repair.enforceSlotUniqueness;
exports.salvageCompetingBases = repair.salvageCompetingBases;
exports.repairCrossLookPacking = repair.repairCrossLookPacking;
exports.repairBeltFootwearMatch = repair.repairBeltFootwearMatch;
exports.beltFootwearMatchScore = repair.beltFootwearMatchScore;
exports.leatherToneFamily = repair.leatherToneFamily;
exports.packingSummary = repair.packingSummary;
exports.assembleRandomLooks = assemble.assembleRandomLooks;
exports.assembleWithBedrock = assemble.assembleWithBedrock;
exports.serializeCatalogForPrompt = assemble.serializeCatalogForPrompt;
exports.selectCatalogForPrompt = assemble.selectCatalogForPrompt;
exports.catalogSubsetScore = assemble.catalogSubsetScore;
exports.targetFormalityRankFromContext = assemble.targetFormalityRankFromContext;
exports.systemPrompt = assemble.systemPrompt;
exports.validateLookPayload = assemble.validateLookPayload;
exports.parseJsonObject = core.parseJsonObject;
exports.assertLooksComplete = repair.assertLooksComplete;
exports.lookCompleteness = repair.lookCompleteness;
exports.lookHasBlackSuitBlackTie = repair.lookHasBlackSuitBlackTie;
exports.softStyleClashes = repair.softStyleClashes;
exports.catalogHasFootwear = repair.catalogHasFootwear;
exports.filterRandomLooksComplete = repair.filterRandomLooksComplete;
exports.contextNeedsColdLayer = core.contextNeedsColdLayer;
exports.contextHasCoolWeather = core.contextHasCoolWeather;
exports.isThinBaseLayer = core.isThinBaseLayer;
exports.isWarmInsulationPiece = core.isWarmInsulationPiece;
exports.isWarmClosedBase = core.isWarmClosedBase;
exports.lookNeedsWarmInsulation = brief.lookNeedsWarmInsulation;
exports.completenessOptionsForLook = repair.completenessOptionsForLook;
exports.completenessRepairNote = assemble.completenessRepairNote;
exports.trousersNeedWaistFinish = repair.trousersNeedWaistFinish;
exports.trousersSuspenderCapable = repair.trousersSuspenderCapable;
exports.isBeltItem = repair.isBeltItem;
exports.isSuspendersItem = repair.isSuspendersItem;
exports.repairLookLocally = repair.repairLookLocally;
exports.repairLooksLocally = repair.repairLooksLocally;
exports.backfillLooksDeterministic = repair.backfillLooksDeterministic;
exports.filterCompleteLooks = repair.filterCompleteLooks;
exports.maxTokensForLookCount = brief.maxTokensForLookCount;
exports.catalogCapMeta = http.catalogCapMeta;
exports.suggestLooks = http.suggestLooks;
