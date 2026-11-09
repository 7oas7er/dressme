/**
 * Sanzo Wada Vol. 1 reference palette (DressMe-shaped, MIT mattdesl dataset).
 * IDs are stable: wada:v1:{0…158}. SPA resolves hex/name; Dynamo stores IDs only.
 */

import palette from "./data/wada-colors.v1.json" with { type: "json" };

export const MAX_WADA_COLORS = 4;

const BY_ID = new Map();
for (const color of palette.colors || []) {
  BY_ID.set(color.id, color);
}

export const WADA_COLORS = palette.colors || [];

export function getWadaColor(id) {
  if (id == null) return null;
  return BY_ID.get(String(id)) || null;
}

export function resolveWadaHex(id) {
  const row = getWadaColor(id);
  return row ? row.hex : "";
}

export function resolveWadaName(id) {
  const row = getWadaColor(id);
  return row ? row.name : "";
}

/** Primary = index 0. */
export function primaryWadaId(ids) {
  if (!Array.isArray(ids) || !ids.length) return "";
  return String(ids[0] || "");
}

export function primaryWadaHex(ids) {
  return resolveWadaHex(primaryWadaId(ids));
}

/**
 * Dedupe preserving order; clamp to max; drop unknown IDs.
 * @returns {string[]}
 */
export function normalizeWadaColorIdsClient(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || "");
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_WADA_COLORS) break;
  }
  return out;
}

/** Case-insensitive name substring filter. */
export function searchWadaColors(query, { excludeIds = [] } = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const exclude = new Set((excludeIds || []).map(String));
  return WADA_COLORS.filter((color) => {
    if (exclude.has(color.id)) return false;
    if (!q) return true;
    return String(color.name || "")
      .toLowerCase()
      .includes(q);
  });
}
