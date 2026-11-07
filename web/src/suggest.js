/**
 * UC-04–06 suggest UX helpers: look headlines/summaries.
 * Layered hero + authenticity strip live in lookLayout.js / lookCard.js.
 * UC-09 rationale is rendered under the look body in lookCard.js.
 * No worn/like/reject recording in v1 (UC-06).
 */

/** Prefer full-res for hero detail; fall back to overview thumb (legacy helper). */
export function collagePhotoUrl(item) {
  const photo = (item.photos || []).find((p) => p.url || p.thumbUrl);
  if (!photo) return "";
  return photo.url || photo.thumbUrl || "";
}

export function lookHeadline(look, index) {
  const n = look && look.lookId ? look.lookId : String(index + 1);
  return `Look ${n}`;
}

export function lookSummary(look) {
  const items = (look && look.items) || [];
  if (!items.length) return "No pieces available for this look.";
  return items
    .map((item) => {
      const role = String(item.outfitRole || item.type || "piece").trim();
      const color = String(item.color || "").trim();
      return color ? `${color} ${role}` : role;
    })
    .join(" · ");
}
