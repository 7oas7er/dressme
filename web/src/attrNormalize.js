/**
 * Attribute-value hygiene (Phase 1) — SPA copy.
 * Keep in sync with infra/lambda/attrNormalize.js (twin helpers; no shared package yet).
 */

export const MAX_ATTR_LEN = 120;
const DELIMITER_RE = /[/|;,&]+/g;

/** Rules 1–2: Unicode trim, collapse internal whitespace, clamp ≤120. */
export function lightNormalize(value) {
  if (value == null) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.slice(0, MAX_ATTR_LEN);
}

/**
 * Rules 1–4: light normalize + delimiter unify + strip trailing . ,
 * Colors stay one string; `/` `|` `;` `&` → `, `.
 */
export function normalizeAttrValue(value) {
  let text = lightNormalize(value);
  if (!text) return "";
  text = text.replace(DELIMITER_RE, ", ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/\s*,\s*/g, ", ");
  text = text.replace(/[.,]+$/g, "").trim();
  text = text.replace(/(?:,\s*)+$/g, "").trim();
  if (!text) return "";
  return text.slice(0, MAX_ATTR_LEN);
}

/** Case-fold + drop periods (initialisms: U.S.A. ≈ USA). Matching only. */
export function foldForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "");
}

export function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  if (Math.abs(s.length - t.length) > 1) return 2;
  let prev = new Array(t.length + 1);
  let cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    let minInRow = cur[0];
    for (let j = 1; j <= t.length; j++) {
      const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      const ins = cur[j - 1] + 1;
      const del = prev[j] + 1;
      const sub = prev[j - 1] + cost;
      let next = ins < del ? ins : del;
      if (sub < next) next = sub;
      cur[j] = next;
      if (next < minInRow) minInRow = next;
    }
    if (minInRow > 1) return 2;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[t.length];
}

function customFoldSet(customList) {
  const set = Object.create(null);
  const list = Array.isArray(customList) ? customList : [];
  for (let i = 0; i < list.length; i++) {
    const fold = foldForMatch(list[i]);
    if (fold) set[fold] = true;
  }
  return set;
}

function isSeedOption(option, customs) {
  return !customs[foldForMatch(option)];
}

/** Prefer seed over custom, then shortest, then localeCompare. */
function compareCandidates(a, b, customs) {
  const aSeed = isSeedOption(a, customs);
  const bSeed = isSeedOption(b, customs);
  if (aSeed !== bSeed) return aSeed ? -1 : 1;
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function pickBest(candidates, customs) {
  if (!candidates.length) return null;
  candidates.sort((a, b) => compareCandidates(a, b, customs));
  return candidates[0];
}

/**
 * Classify raw input against option list for blur chips / silent rewrite.
 * @returns {{ normalized: string, action: 'exact'|'silent'|'chip'|'none', suggestion: string|null }}
 */
export function matchAttrOption(raw, options, customList) {
  const normalized = normalizeAttrValue(raw);
  if (!normalized) {
    return { normalized: "", action: "none", suggestion: null };
  }
  const opts = Array.isArray(options) ? options : [];
  const customs = customFoldSet(customList);
  const normFold = foldForMatch(normalized);

  const foldEquals = [];
  for (let i = 0; i < opts.length; i++) {
    const opt = String(opts[i] || "").trim();
    if (!opt) continue;
    if (foldForMatch(opt) === normFold) foldEquals.push(opt);
  }
  if (foldEquals.length) {
    const best = pickBest(foldEquals, customs);
    if (normalized === best) {
      return { normalized: best, action: "exact", suggestion: null };
    }
    // Casing/whitespace-only vs delimiter/punct-caused fold match.
    const light = lightNormalize(raw);
    if (foldForMatch(light) === foldForMatch(best)) {
      return { normalized: best, action: "silent", suggestion: best };
    }
    return { normalized: normalized, action: "chip", suggestion: best };
  }

  const typos = [];
  for (let j = 0; j < opts.length; j++) {
    const candidate = String(opts[j] || "").trim();
    if (!candidate) continue;
    if (levenshtein(normFold, foldForMatch(candidate)) === 1) {
      typos.push(candidate);
    }
  }
  if (typos.length) {
    const tip = pickBest(typos, customs);
    return { normalized: normalized, action: "chip", suggestion: tip };
  }
  return { normalized: normalized, action: "none", suggestion: null };
}

/**
 * Persist path helper: rules 1–4 + silent fold rewrite (no typo auto-apply).
 * Mirrors Lambda canonicalizeAttrValue.
 */
export function canonicalizeAttrValue(raw, options, customList) {
  const normalized = normalizeAttrValue(raw);
  if (!normalized) return "";
  const opts = Array.isArray(options) ? options : [];
  const customs = customFoldSet(customList);
  const normFold = foldForMatch(normalized);
  const foldEquals = [];
  for (let i = 0; i < opts.length; i++) {
    const opt = String(opts[i] || "").trim();
    if (!opt) continue;
    if (foldForMatch(opt) === normFold) foldEquals.push(opt);
  }
  if (foldEquals.length) {
    return pickBest(foldEquals, customs);
  }
  return normalized;
}
