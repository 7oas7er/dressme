/**
 * Slice B — client Lab nearest match against the vendored Wada palette.
 * CIE76 ΔE is enough for wardrobe tagging; Frank confirms before Save.
 */

import { WADA_COLORS, getWadaColor } from "./wadaPalette.js";

/** D65 reference white (sRGB). */
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function srgbChannelToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labF(t) {
  return t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;
}

/**
 * Parse #rgb / #rrggbb (case-insensitive) → { r, g, b } 0–255, or null.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function parseHexRgb(hex) {
  const raw = String(hex || "")
    .trim()
    .replace(/^#/, "");
  let full = raw;
  if (raw.length === 3) {
    full = raw
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * sRGB 0–255 → CIE Lab (D65).
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {{ L: number, a: number, b: number }}
 */
export function rgbToLab(rgb) {
  const R = srgbChannelToLinear(rgb.r);
  const G = srgbChannelToLinear(rgb.g);
  const B = srgbChannelToLinear(rgb.b);
  // sRGB → XYZ (D65)
  const x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** @param {string} hex */
export function hexToLab(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  return rgbToLab(rgb);
}

/** CIE76 ΔE. */
export function deltaE76(labA, labB) {
  const dL = labA.L - labB.L;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

const PALETTE_LAB = WADA_COLORS.map((color) => ({
  id: color.id,
  name: color.name,
  hex: color.hex,
  lab: hexToLab(color.hex),
})).filter((row) => row.lab);

/**
 * Rank palette by CIE76 distance to a sample hex.
 * @param {string} sampleHex
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ id: string, name: string, hex: string, deltaE: number }>}
 */
export function nearestWadaColors(sampleHex, { limit = 1 } = {}) {
  const sampleLab = hexToLab(sampleHex);
  if (!sampleLab) return [];
  const n = Math.max(1, Math.min(Number(limit) || 1, PALETTE_LAB.length));
  const ranked = PALETTE_LAB.map((row) => ({
    id: row.id,
    name: row.name,
    hex: row.hex,
    deltaE: deltaE76(sampleLab, row.lab),
  }));
  ranked.sort((a, b) => a.deltaE - b.deltaE);
  return ranked.slice(0, n);
}

/**
 * Top-1 convenience; returns null when sample hex is invalid.
 * @param {string} sampleHex
 */
export function nearestWadaColor(sampleHex) {
  const hits = nearestWadaColors(sampleHex, { limit: 1 });
  return hits[0] || null;
}

/** Resolve a known id to a ranked row (for tests / UI). */
export function wadaColorWithLab(id) {
  const color = getWadaColor(id);
  if (!color) return null;
  return { ...color, lab: hexToLab(color.hex) };
}
