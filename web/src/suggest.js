/**
 * UC-04–06 suggest UX helpers: look headlines/summaries + session JSON export.
 * Photos-only look cards + Wada plate live in lookCard.js / lookWadaPlate.js.
 * UC-09 rationale is rendered under the look body in lookCard.js.
 * No worn/like/reject recording in v1 (UC-06).
 */

import {
  getWadaColor,
  primaryWadaId,
  resolveWadaName,
} from "./wadaPalette.js";

const MAX_LOOK_TITLE = 48;

const EXPORT_ITEM_FIELDS = [
  "type",
  "brandModel",
  "fabric",
  "formality",
  "pattern",
  "season",
  "outfitRole",
  "aiContext",
];

/** Prefer full-res for hero detail; fall back to overview thumb (legacy helper). */
export function collagePhotoUrl(item) {
  const photo = (item.photos || []).find((p) => p.url || p.thumbUrl);
  if (!photo) return "";
  return photo.url || photo.thumbUrl || "";
}

/** Clamp AI look title for display (matches Lambda MAX_TITLE). */
export function clampLookTitle(value) {
  return String(value == null ? "" : value)
    .replace(/[`*_~]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .slice(0, MAX_LOOK_TITLE);
}

export function lookHeadline(look, index) {
  const n = look && look.lookId ? look.lookId : String(index + 1);
  const title = clampLookTitle(look && look.title);
  return title ? `Look ${n} · ${title}` : `Look ${n}`;
}

export function lookSummary(look) {
  const items = (look && look.items) || [];
  if (!items.length) return "No pieces available for this look.";
  return items
    .map((item) => {
      const role = String(item.outfitRole || item.type || "piece").trim();
      const primaryId = primaryWadaId(item && item.wadaColorIds);
      const color = primaryId ? resolveWadaName(primaryId) : "";
      return color ? `${color} ${role}` : role;
    })
    .join(" · ");
}

/** Resolve Wada ids → { id, name, hex } for reflection (omit unresolved). */
export function exportWadaRefs(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id) continue;
    const color = getWadaColor(id);
    if (!color || !color.name || !color.hex) {
      out.push({ id });
      continue;
    }
    out.push({ id, name: color.name, hex: color.hex });
  }
  return out;
}

/** Strip photo URLs; keep photoIds + attrs needed for hillclimb reflection. */
export function exportItemForSuggest(item) {
  if (!item || typeof item !== "object") return null;
  const itemId = String(item.itemId || item.id || "").trim();
  const out = {};
  if (itemId) out.itemId = itemId;
  for (const key of EXPORT_ITEM_FIELDS) {
    const value = item[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  const wada = exportWadaRefs(item.wadaColorIds);
  if (wada.length) out.wada = wada;
  const photoIds = (item.photos || [])
    .map((photo) => String((photo && photo.photoId) || "").trim())
    .filter(Boolean);
  if (photoIds.length) out.photoIds = photoIds;
  return out;
}

/**
 * Build a clipboard/download payload from in-memory Suggest session state.
 * Client-only — no API/Dynamo. Omits signed photo URLs.
 *
 * @param {{
 *   context?: string,
 *   looks?: Array | null,
 *   engine?: string,
 *   modelId?: string,
 *   suggestionId?: string,
 *   requestedLookCount?: number,
 *   returnedLookCount?: number,
 *   lookCountShortfall?: boolean,
 *   packing?: object | null,
 *   packingLimits?: object | null,
 *   occasions?: Array | null,
 * }} session
 * @param {{ now?: () => Date }} [options]
 */
export function buildSuggestExportPayload(session, options = {}) {
  const nowFn = options.now || (() => new Date());
  const looksIn = Array.isArray(session && session.looks) ? session.looks : [];
  const looks = looksIn.map((look, index) => {
    const items = (look && look.items) || [];
    const exportedItems = items
      .map((item) => exportItemForSuggest(item))
      .filter(Boolean);
    const itemIds =
      Array.isArray(look && look.itemIds) && look.itemIds.length
        ? look.itemIds.map(String).filter(Boolean)
        : exportedItems.map((item) => item.itemId).filter(Boolean);
    const row = {
      lookId: String((look && look.lookId) || index + 1),
      title: clampLookTitle(look && look.title),
      rationale: String((look && look.rationale) || "").trim(),
      itemIds,
      items: exportedItems,
    };
    return row;
  });

  const requested = Number(session && session.requestedLookCount) || 0;
  const returned =
    Number(session && session.returnedLookCount) || looks.length;
  const payload = {
    exportedAt: nowFn().toISOString(),
    context: String((session && session.context) || "").trim(),
    lookCount: looks.length,
    looks,
  };
  if (requested > 0) payload.requestedLookCount = requested;
  if (returned > 0) payload.returnedLookCount = returned;
  if (session && session.lookCountShortfall) {
    payload.lookCountShortfall = true;
  }
  if (session && session.packing && typeof session.packing === "object") {
    payload.packing = session.packing;
  }
  if (
    session &&
    session.packingLimits &&
    typeof session.packingLimits === "object"
  ) {
    payload.packingLimits = session.packingLimits;
  }
  if (session && Array.isArray(session.occasions) && session.occasions.length) {
    payload.occasions = session.occasions;
  }
  const engine = String((session && session.engine) || "").trim();
  if (engine) payload.engine = engine;
  const modelId = String((session && session.modelId) || "").trim();
  if (modelId) payload.modelId = modelId;
  const suggestionId = String((session && session.suggestionId) || "").trim();
  if (suggestionId) payload.suggestionId = suggestionId;
  return payload;
}

export function suggestExportFilename(exportedAt = new Date()) {
  const d = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  const iso = Number.isNaN(d.getTime()) ? new Date() : d;
  const stamp = iso
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  return `dressme-suggest-${stamp}.json`;
}

export function stringifySuggestExport(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Copy plain text; falls back to a temporary textarea when Clipboard API is missing. */
export async function copyTextToClipboard(text) {
  const value = String(text == null ? "" : text);
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("clipboard_unavailable");
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const ok =
    typeof document.execCommand === "function" &&
    document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("clipboard_unavailable");
}

/** Trigger a JSON file download in the browser (Blob + temporary anchor). */
export function downloadTextFile(filename, text, mime = "application/json") {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("download_unavailable");
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
