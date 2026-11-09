/**
 * UC-04–06 suggest UX helpers: look headlines/summaries.
 * Photos-only look cards + Wada plate live in lookCard.js / lookWadaPlate.js.
 * UC-09 rationale is rendered under the look body in lookCard.js.
 * No worn/like/reject recording in v1 (UC-06).
 */

import { primaryWadaId, resolveWadaName } from "./wadaPalette.js";

const MAX_LOOK_TITLE = 48;

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
