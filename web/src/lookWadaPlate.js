/**
 * Ad-hoc Wada combination plate for a look card (display only).
 * Primary Wada only; skip items without a resolvable primary; dedupe identical IDs.
 * No free-text color fallback. UC-28 book combo IDs are out of scope.
 */

import { getWadaColor, primaryWadaId } from "./wadaPalette.js";

/**
 * @param {Array<{ wadaColorIds?: string[] }>} items look items in display order
 * @returns {Array<{ id: string, name: string, hex: string }>}
 */
export function lookWadaPlateEntries(items) {
  const entries = [];
  const seen = new Set();
  for (const item of items || []) {
    const id = primaryWadaId((item && item.wadaColorIds) || []);
    if (!id || seen.has(id)) continue;
    const color = getWadaColor(id);
    if (!color || !color.hex || !color.name) continue;
    seen.add(id);
    entries.push({ id, name: color.name, hex: color.hex });
  }
  return entries;
}
