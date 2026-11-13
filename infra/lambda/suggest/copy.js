"use strict";

var core = require("./core");
var brief = require("./brief");

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

/**
 * Natural wardrobe colour for piece nouns — prefer a common colour word
 * extracted from Wada/fabric over a full Wada plate name as the garment adjective.
 */
function naturalColorWord(item) {
  var cue = colorCueFromItem(item);
  if (cue) return cue;
  var wada = itemPrimaryWadaName(item);
  if (!wada) return "";
  var bits = String(wada)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (bits.length === 1 && COLOR_WORD_RE.test(bits[0])) {
    return bits[0].toLowerCase();
  }
  return "";
}

/**
 * Wardrobe noun phrase: colour + type (+ fabric), brand secondary in parens.
 * Never treat brand/model as the garment noun alone ("Black Gipsy").
 */
function itemLabel(item) {
  var row = item || {};
  var color = naturalColorWord(row);
  var brand = String(row.brandModel || "").trim();
  var type = String(row.type || row.outfitRole || "piece").trim() || "piece";
  var fabric = String(row.fabric || "").trim();
  var lowerType = type.toLowerCase();
  var lowerBrand = brand.toLowerCase();

  var fabricBits = fabric
    ? fabric.split(/\s+/).filter(function (bit) {
        var b = bit.toLowerCase();
        if (!b) return false;
        if (color && b === color) return false;
        if (lowerType.indexOf(b) >= 0) return false;
        if (lowerBrand && lowerBrand.indexOf(b) >= 0) return false;
        return true;
      })
    : [];
  var fabricLead = fabricBits.join(" ");

  var core = type;
  if (fabricLead) core = fabricLead + " " + core;
  if (color && !new RegExp("\\b" + color + "\\b", "i").test(core)) {
    core = color + " " + core;
  }

  if (brand && lowerBrand !== lowerType) {
    return core + " (" + brand + ")";
  }
  return core;
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

/** Parse "two"/"2" style counts for packing limits. */
function colorCueFromItem(item) {
  var wada = itemPrimaryWadaName(item);
  if (wada) {
    var known = wada.match(COLOR_WORD_RE);
    if (known) return known[1].toLowerCase();
  }
  var fabric = String((item && item.fabric) || "").toLowerCase();
  var fabColor = fabric.match(COLOR_WORD_RE);
  return fabColor ? fabColor[1].toLowerCase() : "";
}

function shortTypeWord(item) {
  var type = String((item && (item.type || item.outfitRole)) || "")
    .toLowerCase()
    .trim();
  if (/\bblazer\b/.test(type)) return "blazer";
  if (/\bcoat\b/.test(type)) return "coat";
  if (/\bjacket\b/.test(type)) return "jacket";
  if (/\bcardigan\b/.test(type)) return "cardigan";
  if (/\bsweater|turtleneck|\bknit\b/.test(type)) return "sweater";
  if (/\bjeans?\b/.test(type)) return "jeans";
  if (/\bshirt\b/.test(type)) return "shirt";
  if (/\btrousers?\b|\bpants\b|\bchinos?\b/.test(type)) return "trousers";
  if (/\bboots?\b/.test(type)) return "boots";
  if (/\bshoe|\bloafer|\bderby/.test(type)) return "shoes";
  if (/\bbelt\b/.test(type)) return "belt";
  var bits = type.split(/\s+/).filter(Boolean);
  return bits.length ? bits[bits.length - 1] : "";
}

function pieceTypeLabel(item) {
  return itemLabel(item);
}

function copyLooksBroken(title, rationale) {
  var blob = String(title || "") + " " + String(rationale || "");
  if (BROKEN_COPY_RE.test(blob)) return true;
  if (/\bI would\s*$/i.test(String(title || "").trim())) return true;
  if (/anchors the look for I would/i.test(blob)) return true;
  return false;
}

/** True when rationale shows the old deterministic template skeleton. */
function copyLooksFormulaic(title, rationale) {
  var blob = String(rationale || "") || String(title || "");
  var hits = 0;
  for (var i = 0; i < FORMULAIC_COPY_RES.length; i++) {
    if (FORMULAIC_COPY_RES[i].test(blob)) hits += 1;
  }
  return hits >= 2;
}

var FLAT_TYPE_WORD_RE =
  /^(blazer|coat|jacket|cardigan|shirt|trousers|shoes|look|navy|line|outfit)$/i;
var FLAT_FILLER_ADJ_RE = /^(soft|sharp|quiet|bold|calm|clean)$/i;

function normalizeTitleFlatText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_~"']/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens that are only color / garment-type (optional one filler adj). */
function tokensAreColorOrTypeStub(toks) {
  var list = (toks || []).filter(Boolean);
  if (!list.length) return false;
  var start = 0;
  if (list.length >= 2 && FLAT_FILLER_ADJ_RE.test(list[0])) start = 1;
  var slice = list.slice(start);
  if (!slice.length || slice.length > 2) return false;
  return slice.every(function (tok) {
    return COLOR_WORD_RE.test(tok) || FLAT_TYPE_WORD_RE.test(tok);
  });
}

/**
 * Residual post-#139 templates Frank rejected on stg smoke — e.g.
 * "black blazer that carries Lunch", "Lunch-ready blazer",
 * "Quiet gray blazer, Lunch cut".
 */
function residualTemplateIsFlat(raw, target) {
  if (!raw || !target) return false;
  // "{color|type…} that carries {cue}"
  var carries = " that carries " + target;
  var cIdx = raw.indexOf(carries);
  if (cIdx > 0) {
    var beforeCarries = raw.slice(0, cIdx).trim();
    var afterCarries = raw.slice(cIdx + carries.length).trim();
    if (
      !afterCarries &&
      tokensAreColorOrTypeStub(beforeCarries.split(/\s+/))
    ) {
      return true;
    }
  }
  // "{cue} ready {type}" (hyphens already normalized to spaces)
  var readyPrefix = target + " ready ";
  if (raw.indexOf(readyPrefix) === 0) {
    var afterReady = raw.slice(readyPrefix.length).trim();
    if (tokensAreColorOrTypeStub(afterReady.split(/\s+/))) return true;
  }
  // "{adj?} {color?} {type?}, {cue} cut" (comma kept by normalize)
  var commaCut = ", " + target + " cut";
  var cutIdx = raw.indexOf(commaCut);
  if (cutIdx > 0) {
    var beforeComma = raw.slice(0, cutIdx).trim();
    if (tokensAreColorOrTypeStub(beforeComma.split(/\s+/))) return true;
  }
  // Same without comma: "quiet gray blazer lunch cut"
  var spaceCut = " " + target + " cut";
  if (raw.length > spaceCut.length && raw.slice(-spaceCut.length) === spaceCut) {
    var beforeCut = raw.slice(0, raw.length - spaceCut.length).trim();
    if (tokensAreColorOrTypeStub(beforeCut.split(/\s+/))) return true;
  }
  return false;
}

/** Residual skeletons when occasion meta is missing. */
function residualSkeletonWithoutCue(raw) {
  if (!raw) return false;
  var carriesMatch = raw.match(/^(.+?)\s+that carries\s+(.+)$/);
  if (
    carriesMatch &&
    tokensAreColorOrTypeStub(carriesMatch[1].split(/\s+/)) &&
    carriesMatch[2].split(/\s+/).filter(Boolean).length <= 3
  ) {
    return true;
  }
  var readyMatch = raw.match(/^(.+?)\s+ready\s+(.+)$/);
  if (
    readyMatch &&
    readyMatch[1].split(/\s+/).filter(Boolean).length <= 3 &&
    tokensAreColorOrTypeStub(readyMatch[2].split(/\s+/))
  ) {
    return true;
  }
  var cutMatch = raw.match(/^(.+?),\s*(.+?)\s+cut$/);
  if (
    cutMatch &&
    tokensAreColorOrTypeStub(cutMatch[1].split(/\s+/)) &&
    cutMatch[2].split(/\s+/).filter(Boolean).length <= 3
  ) {
    return true;
  }
  return false;
}

/**
 * True when the title is a bare occasion↔color/type stub or residual template —
 * e.g. "Board day blue", "blue for Dinner look", "Soft blue for Dinner",
 * "black blazer that carries Lunch", "Lunch-ready blazer",
 * "Quiet gray blazer, Lunch cut".
 */
function titleLooksFlat(title, occasion) {
  var raw = normalizeTitleFlatText(title);
  if (!raw) return true;
  var cue = normalizeTitleFlatText(
    (occasion && (occasion.shortTitle || occasion.label)) || ""
  );
  var cueCore = cue.replace(/\s+look$/, "").trim();

  function prefixIsFlat(prefix) {
    if (!prefix || raw.indexOf(prefix) !== 0) return false;
    var rest = raw.slice(prefix.length).trim();
    if (!rest) return true;
    return tokensAreColorOrTypeStub(rest.split(/\s+/));
  }

  function colorForTargetIsFlat(target) {
    if (!target) return false;
    var marker = " for " + target;
    var idx = raw.indexOf(marker);
    if (idx <= 0) return false;
    var before = raw.slice(0, idx).trim();
    var after = raw.slice(idx + marker.length).trim();
    // Allow a dangling "look" only ("blue for Dinner" vs cue "Dinner look").
    if (after && after !== "look") return false;
    return tokensAreColorOrTypeStub(before.split(/\s+/));
  }

  if (!cue) {
    // "{color} for {short occasion}" without structured meta still reads as a stub.
    var forMatch = raw.match(/^(.+?)\s+for\s+(.+)$/);
    if (
      forMatch &&
      tokensAreColorOrTypeStub(forMatch[1].split(/\s+/)) &&
      forMatch[2].split(/\s+/).filter(Boolean).length <= 3
    ) {
      return true;
    }
    if (residualSkeletonWithoutCue(raw)) return true;
    return (
      tokensAreColorOrTypeStub(raw.split(/\s+/)) &&
      !/\b(with|ready|meets|that|carries|travels|presence|intent|confidence|energy|power)\b/.test(
        raw
      )
    );
  }

  if (raw === cue || (cueCore && raw === cueCore)) return true;
  if (prefixIsFlat(cue) || (cueCore && cueCore !== cue && prefixIsFlat(cueCore))) {
    return true;
  }
  if (colorForTargetIsFlat(cue) || colorForTargetIsFlat(cueCore)) return true;
  if (residualTemplateIsFlat(raw, cue) || residualTemplateIsFlat(raw, cueCore)) {
    return true;
  }
  if (residualSkeletonWithoutCue(raw)) return true;
  return false;
}

function lookAnchorPiece(pieces) {
  for (var i = 0; i < (pieces || []).length; i++) {
    if (classifySlot(pieces[i]) === "outer") return pieces[i];
  }
  for (var b = 0; b < (pieces || []).length; b++) {
    if (classifySlot(pieces[b]) === "base") return pieces[b];
  }
  return (pieces && pieces[0]) || null;
}

function pieceDetail(item) {
  // itemLabel already folds colour + fabric + type (+ brand); avoid "… in fabric".
  return itemLabel(item);
}

/**
 * True when copy names a catalog brand/model as the garment noun without
 * that piece's type/role (e.g. "Black Gipsy in leather" vs "black leather jacket").
 */
function copyLooksBrandAsNoun(title, rationale, pieces) {
  var blob = String(title || "") + " " + String(rationale || "");
  var lower = blob.toLowerCase();
  if (!lower.trim()) return false;
  for (var i = 0; i < (pieces || []).length; i++) {
    var item = pieces[i];
    var brand = String((item && item.brandModel) || "").trim();
    var type = String((item && (item.type || item.outfitRole)) || "").trim();
    if (!brand || brand.length < 3) continue;
    if (!type || type.toLowerCase() === brand.toLowerCase()) continue;
    if (lower.indexOf(brand.toLowerCase()) < 0) continue;
    var typeWord = shortTypeWord(item);
    var typeTokens = significantTokens(type);
    var hasType = false;
    if (typeWord && lower.indexOf(typeWord.toLowerCase()) >= 0) {
      hasType = true;
    }
    for (var t = 0; !hasType && t < typeTokens.length; t++) {
      if (lower.indexOf(typeTokens[t]) >= 0) hasType = true;
    }
    if (!hasType) return true;
  }
  return false;
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
 * Deterministic title + rationale from structured occasion + piece attrs/Wada.
 * Never pastes raw session context. Titles are occasion-led (not Wada+brand).
 * Voice rotates by look index so fallback copy is not identical boilerplate.
 * Prefer Bedrock rewrite when budget allows — this is the true fallback.
 */
function rewriteLookCopy(look, byId, context, opts) {
  opts = opts || {};
  var brief = opts.brief || parseTripBrief(context, null);
  var occasion =
    opts.occasion || occasionForLook(brief, look, opts.index);
  var ids = lookItemIds(look);
  var pieces = ids
    .map(function (id) {
      return byId && typeof byId.get === "function" ? byId.get(id) : null;
    })
    .filter(Boolean);
  var anchor = lookAnchorPiece(pieces);
  var cue = contextCue(context, occasion);
  var cold = brief.cold || contextNeedsColdLayer(context);
  var color = colorCueFromItem(anchor);
  var typeWord = shortTypeWord(anchor);
  var variant =
    (opts.index != null
      ? opts.index
      : Math.max(0, (parseInt(String((look && look.lookId) || "1"), 10) || 1) - 1)) %
    3;
  // Personality-led fallback titles — thematic, rotated voice. Prefer Bedrock
  // rewrite when budget allows. Never bare "{shortTitle} {color}",
  // "{color} for {shortTitle}", "{color} {type} that carries {cue}",
  // "{cue}-ready {type}", or "Quiet {color} {type}, {cue} cut". Do not force
  // the occasion word into every title.
  var cueCore = String(cue || "")
    .replace(/\s+look$/i, "")
    .trim();
  if (!cueCore) cueCore = cue;
  var titleSeed;
  if (variant === 0 && color) {
    titleSeed = "Soft power in " + color;
  } else if (variant === 1 && typeWord) {
    titleSeed = "Quiet " + typeWord + " confidence";
  } else if (variant === 2 && color && typeWord) {
    titleSeed = color + " " + typeWord + " with intent";
  } else if (color && typeWord) {
    titleSeed = color + " " + typeWord + " with presence";
  } else if (typeWord) {
    titleSeed = typeWord + " with quiet confidence";
  } else if (color) {
    titleSeed = color + " with intent";
  } else if (cueCore) {
    titleSeed = cueCore + " with presence";
  } else {
    titleSeed = "Closet look";
  }
  if (cold && !cue && titleSeed.indexOf("Layered") < 0) {
    titleSeed = clampTitle("Layered " + titleSeed);
  }
  var title = clampTitle(titleSeed);
  // Guard mid-phrase / first-person leftovers.
  title = clampTitle(title.replace(/\bI would\b.*$/i, "").trim() || "Closet look");
  // Last-resort escape if a seed still trips flat detection.
  if (titleLooksFlat(title, occasion || (cue ? { shortTitle: cue } : null))) {
    title = clampTitle(
      color
        ? "Soft power in " + color
        : typeWord
          ? "Quiet " + typeWord + " energy"
          : cueCore
            ? cueCore + " with presence"
            : "Closet look"
    );
  }

  var details = pieces.map(pieceDetail);
  var wadaNames = uniqueNonEmpty(pieces.map(itemPrimaryWadaName));
  var fabrics = uniqueNonEmpty(
    pieces.map(function (p) {
      return p && p.fabric;
    })
  );
  if (!details.length) {
    return Object.assign({}, look, { title: title, rationale: "" });
  }

  var occasionLead = cue
    ? cue
    : cold
      ? "cool outdoor air"
      : "this occasion";
  var support = pieces
    .filter(function (p) {
      return p !== anchor;
    })
    .map(pieceDetail)
    .slice(0, 3);
  var sentences = [];
  if (details.length === 1) {
    sentences.push(
      occasionLead +
        " keeps " +
        details[0] +
        " working alone as a clean, wearable line."
    );
  } else if (anchor && variant === 0) {
    sentences.push(
      occasionLead +
        " leans on " +
        pieceDetail(anchor) +
        (support.length
          ? ", backed by " + support.join(", ") + "."
          : ".")
    );
  } else if (anchor && variant === 1) {
    sentences.push(
      "Built for " +
        occasionLead +
        ": " +
        pieceDetail(anchor) +
        (support.length
          ? " with " + support.slice(0, 2).join(" and ") + "."
          : ".")
    );
  } else if (anchor) {
    sentences.push(
      pieceDetail(anchor) +
        " carries " +
        occasionLead +
        (support.length
          ? " while " + support[0] + " keeps the rest grounded."
          : ".")
    );
  } else {
    sentences.push(
      occasionLead +
        " holds together with " +
        details.slice(0, Math.min(3, details.length)).join(", ") +
        "."
    );
  }

  if (fabrics.length) {
    if (variant === 0) {
      sentences.push(
        fabrics.slice(0, 3).join(" / ") +
          " keep the hand practical for classic menswear, not costume."
      );
    } else if (variant === 1) {
      sentences.push(
        "Cloths stay honest — " +
          fabrics.slice(0, 3).join(", ") +
          " — so the set reads wearable rather than styled-for-show."
      );
    } else {
      sentences.push(
        "Fabric weight and finish (" +
          fabrics.slice(0, 3).join(", ") +
          ") suit the day's demands without fighting each other."
      );
    }
  } else if (cold && anchor && classifySlot(anchor) === "outer") {
    sentences.push(
      "The outer layer earns its place against the chill without theatrical extras."
    );
  } else if (variant === 1) {
    sentences.push(
      "Shoe and trouser formality stay in step so the base can sit quietly underneath."
    );
  } else {
    sentences.push(
      "Nothing fights the day: formality between shoe, trouser, and base stays aligned."
    );
  }

  if (wadaNames.length >= 2) {
    if (variant === 0) {
      sentences.push(
        wadaNames.slice(0, 3).join(", ") +
          " lock a true-colour story across the worn pieces."
      );
    } else if (variant === 1) {
      sentences.push(
        "Colour centres on " +
          wadaNames.slice(0, 3).join(" and ") +
          " without inventing hues."
      );
    } else {
      sentences.push(
        "Wada names " +
          wadaNames.slice(0, 3).join(", ") +
          " keep the palette coherent from shoe to outer."
      );
    }
  } else if (wadaNames.length === 1) {
    sentences.push(
      wadaNames[0] +
        " gives the set a clear colour centre without inventing hues."
    );
  } else if (details.length >= 3) {
    sentences.push(
      "Each listed piece pulls weight — nothing ornamental, nothing missing."
    );
  }

  if (
    occasion &&
    occasion.formalityHint &&
    sentences.length < 4
  ) {
    sentences.push(
      "Formality stays near " +
        occasion.formalityHint +
        " for the day's role."
    );
  }

  var rationale = clampText(sentences.slice(0, 4).join(" "), MAX_RATIONALE);
  return Object.assign({}, look, { title: title, rationale: rationale });
}

/**
 * After salvage/repair, rewrite title/rationale when IDs changed, copy names
 * foreign pieces, or title/rationale still pastes raw context / mid-phrase junk.
 */
function syncLookCopy(look, priorIds, byId, catalog, context, opts) {
  opts = opts || {};
  var finalIds = lookItemIds(look);
  var pieces = finalIds
    .map(function (id) {
      return byId && typeof byId.get === "function" ? byId.get(id) : null;
    })
    .filter(Boolean);
  var changed = !sameIdList(priorIds, finalIds);
  var foreign = copyMentionsForeignPieces(
    look && look.title,
    look && look.rationale,
    finalIds,
    byId,
    catalog
  );
  var broken = copyLooksBroken(look && look.title, look && look.rationale);
  var flat = titleLooksFlat(look && look.title, opts.occasion);
  var formulaic = copyLooksFormulaic(
    look && look.title,
    look && look.rationale
  );
  var brandNoun = copyLooksBrandAsNoun(
    look && look.title,
    look && look.rationale,
    pieces
  );
  var force = Boolean(opts.force);
  // Preserve catchy first-pass AI titles when IDs/copy are still valid.
  // force=true after packing must not collapse personality to cue+color stubs.
  if (
    !changed &&
    !foreign &&
    !broken &&
    !flat &&
    !formulaic &&
    !brandNoun &&
    !force
  ) {
    return look;
  }
  if (
    !changed &&
    !foreign &&
    !broken &&
    !flat &&
    !formulaic &&
    !brandNoun &&
    force
  ) {
    return look;
  }
  var reason = changed
    ? "ids_changed"
    : foreign
      ? "foreign_copy"
      : broken
        ? "broken_copy"
        : flat
          ? "flat_title"
          : formulaic
            ? "formulaic_copy"
            : brandNoun
              ? "brand_as_noun"
              : "force";
  console.warn(
    JSON.stringify({
      event: "suggest_copy_rewrite",
      lookId: look && look.lookId,
      reason: reason,
    })
  );
  return rewriteLookCopy(look, byId, context, {
    brief: opts.brief,
    occasion: opts.occasion,
    index: opts.index,
  });
}

function syncLooksCopy(looks, priorIdLists, byId, catalog, context, opts) {
  opts = opts || {};
  var brief =
    opts.brief ||
    parseTripBrief(context, (looks && looks.length) || DEFAULT_LOOK_COUNT);
  var out = [];
  for (var i = 0; i < (looks || []).length; i++) {
    out.push(
      syncLookCopy(
        looks[i],
        (priorIdLists && priorIdLists[i]) || lookItemIds(looks[i]),
        byId,
        catalog,
        context,
        {
          brief: brief,
          occasion: occasionForLook(brief, looks[i], i),
          index: i,
          force: opts.force,
        }
      )
    );
  }
  return out;
}

function copyRewriteSystemPrompt(lookCount) {
  return [
    "You rewrite outfit look titles and rationales for a menswear wardrobe app.",
    'Return JSON only: {"looks":[{"lookId":"1","title":"...","rationale":"..."}]} with exactly ' +
      clampLookCount(lookCount) +
      " looks.",
    'Titles: catchy thematic phrases with personality (about 3–7 words, ≤48 chars) — e.g. "Soft power for the board", "Charcoal that travels", "Garden-evening layers", "Client-calm charcoal". Fit the look\'s vibe; occasion may flavour a title but need not appear in every one. Never flat templates: "{occasion} {color}", "{color} for {occasion}", "{color} {type} that carries {occasion}", "{occasion}-ready {type}", "{adj} {color} {type}, {occasion} cut" — ban "Board day blue", "blue for Dinner look", "black blazer that carries Lunch", "Lunch-ready blazer", "Quiet gray blazer, Lunch cut". Never lead with Wada colour name + brand. Never paste session context. Never end mid-phrase (no trailing "I would").',
    "Rationales: 2–4 sentences with varied voice across looks. First sentence names this look's occasion/day. Then why these pieces fit that day, materials, and Wada/palette harmony — keep Wada quality without identical boilerplate.",
    "Name pieces in natural wardrobe language: colour + type (and fabric when useful), with brand/model only as a secondary tag — e.g. \"black leather jacket (Gipsy)\" or \"black leather Gipsy jacket\". Never treat brand alone as the noun (\"Black Gipsy\", \"Black Hiltl\", \"Black Joe Merino\").",
    'Forbidden skeleton phrases: "anchors the look", "Materials stay honest", "Palette-wise,". Do not reuse the same sentence pattern on every look.',
    "Describe only the listed pieces.",
  ].join("\n");
}

function copyRewriteUserPrompt(looks, byId, brief) {
  var payload = (looks || []).map(function (look, index) {
    var occ = occasionForLook(brief, look, index);
    var ids = lookItemIds(look);
    return {
      lookId: String((look && look.lookId) || index + 1),
      occasion: occ
        ? {
            shortTitle: occ.shortTitle,
            formalityHint: occ.formalityHint || "",
          }
        : null,
      pieces: ids.map(function (id) {
        var item = byId.get(id) || {};
        return {
          id: id,
          type: item.type || "",
          brandModel: item.brandModel || "",
          fabric: item.fabric || "",
          formality: item.formality || "",
          wada: itemPrimaryWadaName(item) || "",
        };
      }),
    };
  });
  return (
    "Rewrite title + rationale for each look from occasion + pieces only.\n" +
    JSON.stringify({ looks: payload })
  );
}

/**
 * Optional short Bedrock pass after slot/packing repair. Falls back to null
 * when the model fails — caller keeps deterministic rewrite.
 */
async function rewriteLooksCopyWithBedrock(looks, byId, brief, callBedrock) {
  if (!looks || !looks.length || typeof callBedrock !== "function") return null;
  try {
    var result = await callBedrock(
      copyRewriteUserPrompt(looks, byId, brief),
      copyRewriteSystemPrompt(looks.length)
    );
    var parsed = parseJsonObject(result.text);
    var rows = parsed && Array.isArray(parsed.looks) ? parsed.looks : null;
    if (!rows || !rows.length) return null;
    var byLookId = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var id = String(row.lookId || i + 1);
      byLookId[id] = row;
    }
    return (looks || []).map(function (look, index) {
      var id = String((look && look.lookId) || index + 1);
      var row = byLookId[id] || rows[index];
      if (!row) return look;
      var title = clampTitle(row.title);
      var rationale = clampText(row.rationale, MAX_RATIONALE);
      var occ = occasionForLook(brief, look, index);
      var pieces = lookItemIds(look)
        .map(function (id) {
          return byId && typeof byId.get === "function" ? byId.get(id) : null;
        })
        .filter(Boolean);
      if (
        !title ||
        copyLooksBroken(title, rationale) ||
        copyLooksFormulaic(title, rationale) ||
        titleLooksFlat(title, occ) ||
        copyLooksBrandAsNoun(title, rationale, pieces)
      ) {
        return rewriteLookCopy(look, byId, "", {
          brief: brief,
          occasion: occ,
          index: index,
        });
      }
      return Object.assign({}, look, { title: title, rationale: rationale });
    });
  } catch (_err) {
    console.warn(
      JSON.stringify({
        event: "suggest_copy_bedrock_rewrite_failed",
      })
    );
    return null;
  }
}

/**
 * Catalog has ≥1 footwear item → footwear is mandatory core for every look.
 */

exports.clampTitle = clampTitle;
exports.colorCueFromItem = colorCueFromItem;
exports.copyLooksBrandAsNoun = copyLooksBrandAsNoun;
exports.copyLooksBroken = copyLooksBroken;
exports.copyLooksFormulaic = copyLooksFormulaic;
exports.copyMentionsForeignPieces = copyMentionsForeignPieces;
exports.titleLooksFlat = titleLooksFlat;
exports.copyRewriteSystemPrompt = copyRewriteSystemPrompt;
exports.copyRewriteUserPrompt = copyRewriteUserPrompt;
exports.itemLabel = itemLabel;
exports.itemMentionTokens = itemMentionTokens;
exports.lookAnchorPiece = lookAnchorPiece;
exports.naturalColorWord = naturalColorWord;
exports.pieceDetail = pieceDetail;
exports.pieceTypeLabel = pieceTypeLabel;
exports.rewriteLookCopy = rewriteLookCopy;
exports.rewriteLooksCopyWithBedrock = rewriteLooksCopyWithBedrock;
exports.sameIdList = sameIdList;
exports.shortTypeWord = shortTypeWord;
exports.significantTokens = significantTokens;
exports.syncLookCopy = syncLookCopy;
exports.syncLooksCopy = syncLooksCopy;
exports.uniqueNonEmpty = uniqueNonEmpty;
