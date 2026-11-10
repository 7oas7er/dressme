/**
 * Ad-hoc Wada combination plate for a look card (display only).
 * Primary Wada only; preserve look/photo order; one swatch per piece
 * (no dedupe / reorder). Skip items without a resolvable primary.
 * No free-text color fallback. UC-28 book combo IDs are out of scope.
 */

import { getWadaColor, primaryWadaId } from "./wadaPalette.js";

/**
 * @param {{ wadaColorIds?: string[], itemId?: string, id?: string } | null | undefined} item
 * @returns {{ id: string, name: string, hex: string, itemId: string } | null}
 */
export function primaryWadaPlateEntry(item) {
  const id = primaryWadaId((item && item.wadaColorIds) || []);
  if (!id) return null;
  const color = getWadaColor(id);
  if (!color || !color.hex || !color.name) return null;
  return {
    id,
    name: color.name,
    hex: color.hex,
    itemId: String((item && (item.itemId || item.id)) || ""),
  };
}

/**
 * Ordered plate entries matching `items` order (typically the photo strip).
 * Does not dedupe identical Wada IDs — two navy pieces → two swatches so each
 * sits above its photo. Skips pieces with no resolvable primary.
 *
 * @param {Array<{ wadaColorIds?: string[], itemId?: string, id?: string }>} items
 * @returns {Array<{ id: string, name: string, hex: string, itemId: string }>}
 */
export function lookWadaPlateEntries(items) {
  const entries = [];
  for (const item of items || []) {
    const entry = primaryWadaPlateEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}
