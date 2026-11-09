/**
 * Option D — map free-text wardrobe color/pattern attrs to SVG fills.
 * Attribute map is the instant fallback; lookCard may override with a
 * client-side thumb dominant-color sample (Phase 1 / Path 4a).
 */

/** Classic menswear seed colors → CSS. Unknown names fall back below. */
const COLOR_MAP = {
  navy: "#1e3a5f",
  charcoal: "#3a4048",
  black: "#1a1a1a",
  grey: "#8a9098",
  gray: "#8a9098",
  "light grey": "#c5cad0",
  "light gray": "#c5cad0",
  white: "#f4f6f8",
  ivory: "#f3efe4",
  cream: "#f0e6d2",
  beige: "#d8c4a4",
  brown: "#6b4423",
  olive: "#5c6b3a",
  "forest green": "#2f4f3a",
  burgundy: "#6b1e2a",
  wine: "#5a1a28",
  "light blue": "#9eb8d4",
  "mid blue": "#4a6fa5",
  blue: "#3d5a80",
  pink: "#d4a0ae",
  purple: "#5c4a7a",
  tan: "#c4a574",
  camel: "#c19a6b",
  red: "#9b2c2c",
  green: "#3d6b4f",
  khaki: "#b8a06a",
  denim: "#3b5270",
};

const FALLBACK_FILL = "#9aa3ad";

/**
 * Resolve a wardrobe color string to a CSS fill.
 * Accepts known names, #hex, and bare CSS named colors when the browser would.
 */
export function resolveFillColor(raw) {
  const value = String(raw || "")
    .toLowerCase()
    .trim();
  if (!value) return FALLBACK_FILL;
  if (COLOR_MAP[value]) return COLOR_MAP[value];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  // Multi-word: try first token (e.g. "navy herringbone" → navy).
  const first = value.split(/[\s,/]+/)[0];
  if (first && COLOR_MAP[first]) return COLOR_MAP[first];
  // Last resort: use the string as a CSS color if it looks like one token.
  if (/^[a-z]+$/i.test(value)) return value;
  return FALLBACK_FILL;
}

/**
 * Cheap pattern hint from the pattern attribute.
 * @returns {"solid"|"stripe"|"check"|null}
 */
export function resolvePatternHint(raw) {
  const value = String(raw || "")
    .toLowerCase()
    .trim();
  if (!value || value === "solid") return "solid";
  if (/stripe|pinstripe/.test(value)) return "stripe";
  if (/check|windowpane|houndstooth|glen|plaid|gingham/.test(value)) {
    return "check";
  }
  return "solid";
}

export const MANNEQUIN_FALLBACK_FILL = FALLBACK_FILL;
