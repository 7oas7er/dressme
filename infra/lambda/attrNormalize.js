"use strict";

/**
 * Attribute-value hygiene (Phase 1) — single shared module.
 * SPA re-exports from web/src/attrNormalize.js; keep this file as the source of truth.
 */

var MAX_ATTR_LEN = 120;
/** Non-brand fields: `/` `|` `;` `&` → `, `. */
var DELIMITER_RE = /[/|;,&]+/g;
/** brandModel: keep `&`; still unify `/` `|` `;` `,`. */
var BRAND_DELIMITER_RE = /[/|;,]+/g;

/**
 * Approved brandModel remaps (foldForMatch key → canonical spelling).
 * Keep small; expand only with Frank-approved drifts.
 */
var BRAND_ALIASES = {
  "joe marino": "Joe Merino",
  "mr mavis": "Mr. Marvis",
  "ruffs,rocks": "Rooks & Rocks",
  "roots,rocks": "Rooks & Rocks",
  "suit supply": "Suitsupply",
  etana: "Eterna",
  "polo ralph lauren": "Ralph Lauren",
};

/** Rules 1–2: Unicode trim, collapse internal whitespace, clamp ≤120. */
function lightNormalize(value) {
  if (value == null) return "";
  var text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.slice(0, MAX_ATTR_LEN);
}

/**
 * Case-fold + drop periods (initialisms: U.S.A. ≈ USA). Matching only.
 * For brandModel, treat `&`, `,`, and ` and ` as the same separator so
 * "Mey, Edlich" / "H, M" can fold-match options that keep `&`.
 */
function foldForMatch(value, field) {
  var text = String(value || "")
    .toLowerCase()
    .replace(/\./g, "");
  if (field === "brandModel") {
    text = text.replace(/\s+and\s+/g, ",");
    text = text.replace(/\s*&\s*/g, ",");
    text = text.replace(/\s*,\s*/g, ",");
  }
  return text;
}

function applyBrandAlias(text) {
  if (!text) return "";
  var fold = foldForMatch(text, "brandModel");
  if (Object.prototype.hasOwnProperty.call(BRAND_ALIASES, fold)) {
    return BRAND_ALIASES[fold];
  }
  return text;
}

/**
 * Rules 1–4: light normalize + delimiter unify + strip trailing . ,
 * Colors stay one string; `/` `|` `;` `&` → `, `.
 * Exception: field === "brandModel" keeps `&`, rewrites ` and ` → ` & `,
 * then applies the approved alias map.
 */
function normalizeAttrValue(value, field) {
  var text = lightNormalize(value);
  if (!text) return "";
  var delim = field === "brandModel" ? BRAND_DELIMITER_RE : DELIMITER_RE;
  text = text.replace(delim, ", ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/\s*,\s*/g, ", ");
  if (field === "brandModel") {
    text = text.replace(/\s+and\s+/gi, " & ");
    text = text.replace(/\s+/g, " ").trim();
  }
  text = text.replace(/[.,]+$/g, "").trim();
  text = text.replace(/(?:,\s*)+$/g, "").trim();
  if (!text) return "";
  text = text.slice(0, MAX_ATTR_LEN);
  if (field === "brandModel") {
    text = applyBrandAlias(text);
  }
  return text;
}

function levenshtein(a, b) {
  var s = String(a || "");
  var t = String(b || "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  if (Math.abs(s.length - t.length) > 1) return 2;
  var prev = new Array(t.length + 1);
  var cur = new Array(t.length + 1);
  var j;
  for (j = 0; j <= t.length; j++) prev[j] = j;
  for (var i = 1; i <= s.length; i++) {
    cur[0] = i;
    var minInRow = cur[0];
    for (j = 1; j <= t.length; j++) {
      var cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      var ins = cur[j - 1] + 1;
      var del = prev[j] + 1;
      var sub = prev[j - 1] + cost;
      var next = ins < del ? ins : del;
      if (sub < next) next = sub;
      cur[j] = next;
      if (next < minInRow) minInRow = next;
    }
    if (minInRow > 1) return 2;
    var swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[t.length];
}

function customFoldSet(customList, field) {
  var set = Object.create(null);
  var list = Array.isArray(customList) ? customList : [];
  for (var i = 0; i < list.length; i++) {
    var fold = foldForMatch(list[i], field);
    if (fold) set[fold] = true;
  }
  return set;
}

function isSeedOption(option, customs, field) {
  return !customs[foldForMatch(option, field)];
}

function hasAmpersand(value) {
  return String(value || "").indexOf("&") !== -1;
}

/** Prefer & forms (brands), then seed over custom, then shortest, then localeCompare. */
function compareCandidates(a, b, customs, field) {
  var aAmp = hasAmpersand(a);
  var bAmp = hasAmpersand(b);
  if (aAmp !== bAmp) return aAmp ? -1 : 1;
  var aSeed = isSeedOption(a, customs, field);
  var bSeed = isSeedOption(b, customs, field);
  if (aSeed !== bSeed) return aSeed ? -1 : 1;
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function pickBest(candidates, customs, field) {
  if (!candidates.length) return null;
  candidates.sort(function (a, b) {
    return compareCandidates(a, b, customs, field);
  });
  return candidates[0];
}

function collectFoldEquals(normFold, opts, field) {
  var foldEquals = [];
  for (var i = 0; i < opts.length; i++) {
    var opt = String(opts[i] || "").trim();
    if (!opt) continue;
    if (foldForMatch(opt, field) === normFold) foldEquals.push(opt);
  }
  return foldEquals;
}

function collectLevenshtein1(normFold, opts, field) {
  var typos = [];
  for (var j = 0; j < opts.length; j++) {
    var candidate = String(opts[j] || "").trim();
    if (!candidate) continue;
    if (levenshtein(normFold, foldForMatch(candidate, field)) === 1) {
      typos.push(candidate);
    }
  }
  return typos;
}

/**
 * Classify raw input against option list for SPA chips / silent rewrite.
 * @returns {{ normalized: string, action: 'exact'|'silent'|'chip'|'none', suggestion: string|null }}
 */
function matchAttrOption(raw, options, customList, field) {
  var normalized = normalizeAttrValue(raw, field);
  if (!normalized) {
    return { normalized: "", action: "none", suggestion: null };
  }
  var opts = Array.isArray(options) ? options : [];
  var customs = customFoldSet(customList, field);
  var normFold = foldForMatch(normalized, field);

  var foldEquals = collectFoldEquals(normFold, opts, field);
  if (foldEquals.length) {
    var best = pickBest(foldEquals, customs, field);
    if (normalized === best) {
      return { normalized: best, action: "exact", suggestion: null };
    }
    // Casing/whitespace-only vs delimiter/punct-caused fold match.
    var light = lightNormalize(raw);
    if (foldForMatch(light, field) === foldForMatch(best, field)) {
      return { normalized: best, action: "silent", suggestion: best };
    }
    return { normalized: normalized, action: "chip", suggestion: best };
  }

  var typos = collectLevenshtein1(normFold, opts, field);
  if (typos.length) {
    var tip = pickBest(typos, customs, field);
    // brandModel: auto-prefer close META/seed spelling (write path + blur).
    if (field === "brandModel") {
      return { normalized: tip, action: "silent", suggestion: tip };
    }
    return { normalized: normalized, action: "chip", suggestion: tip };
  }
  return { normalized: normalized, action: "none", suggestion: null };
}

/**
 * Lambda source of truth: rules 1–4 + silent fold rewrite to option spelling.
 * brandModel also auto-applies Levenshtein-1 matches (prefer &). Other fields do not.
 */
function canonicalizeAttrValue(raw, options, customList, field) {
  var normalized = normalizeAttrValue(raw, field);
  if (!normalized) return "";
  var opts = Array.isArray(options) ? options : [];
  var customs = customFoldSet(customList, field);
  var normFold = foldForMatch(normalized, field);
  var foldEquals = collectFoldEquals(normFold, opts, field);
  if (foldEquals.length) {
    return pickBest(foldEquals, customs, field);
  }
  if (field === "brandModel") {
    var typos = collectLevenshtein1(normFold, opts, field);
    if (typos.length) {
      return pickBest(typos, customs, field);
    }
  }
  return normalized;
}

exports.MAX_ATTR_LEN = MAX_ATTR_LEN;
exports.BRAND_ALIASES = BRAND_ALIASES;
exports.lightNormalize = lightNormalize;
exports.normalizeAttrValue = normalizeAttrValue;
exports.foldForMatch = foldForMatch;
exports.levenshtein = levenshtein;
exports.matchAttrOption = matchAttrOption;
exports.canonicalizeAttrValue = canonicalizeAttrValue;
