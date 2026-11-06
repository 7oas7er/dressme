/**
 * Layered look layout (Option 4 chrome + Option D SVG mannequin hero).
 * Slot synonyms + hero/strip view-model for suggest cards.
 * Hero uses attribute fills (color + cheap pattern hint); strip stays photographic.
 * Cutouts are no longer preferred (generation stopped; existing keys left in place).
 */

import { resolveFillColor, resolvePatternHint } from "./mannequinColor.js";

/** Bottom → top paint / low → high z-index. */
export const HERO_SLOT_ORDER = ["shoes", "trousers", "shirt", "jacket"];

/** Strip reads the body top-down. */
export const STRIP_SLOT_ORDER = ["jacket", "shirt", "trousers", "shoes"];

const SLOT_Z = {
  shoes: 1,
  trousers: 2,
  shirt: 3,
  jacket: 4,
};

/**
 * Vertical bands as % of the hero frame (kept for tests / legacy layout notes).
 * SVG mannequin uses its own path geometry; bands are no longer photo crop guides.
 */
export const SLOT_BANDS = {
  shoes: { topPct: 78, heightPct: 20 },
  trousers: { topPct: 42, heightPct: 42 },
  shirt: { topPct: 14, heightPct: 40 },
  jacket: { topPct: 10, heightPct: 46 },
};

/** @deprecated Option D does not use photo-layer softstop. */
export const SLOT_COMPOSITE = {};

/**
 * Horizontal inset (% of hero width) — kept for API stability; SVG uses paths.
 */
export const SLOT_INSET = {
  shoes: { leftPct: 22, rightPct: 22 },
  trousers: { leftPct: 14, rightPct: 14 },
  shirt: { leftPct: 12, rightPct: 12 },
  jacket: { leftPct: 6, rightPct: 6 },
};

/**
 * Prefer outfitRole, then type. Synonyms cover Lambda suggest roles
 * (footwear/base/outer) and free-text type tokens.
 */
const SLOT_SYNONYMS = [
  {
    slotId: "shoes",
    roles: ["footwear", "shoes", "shoe"],
    types: [
      /shoe/,
      /boot/,
      /loafer/,
      /sneaker/,
      /trainer/,
      /derby/,
      /brogue/,
      /oxford\s*shoe/,
      /monk\s*strap/,
      /chelsea/,
    ],
  },
  {
    slotId: "trousers",
    roles: ["trousers", "pants", "bottoms"],
    types: [
      /trousers/,
      /pants/,
      /jean/,
      /denim/,
      /chino/,
      /short/,
      /trouser/,
      /cord/,
    ],
  },
  {
    slotId: "shirt",
    roles: ["base", "shirt", "knitwear", "top"],
    types: [
      /\bshirt\b/,
      /knit/,
      /sweater/,
      /jumper/,
      /hoodie/,
      /polo/,
      /\btee\b/,
      /t-shirt/,
      /blouse/,
      /\boxford\b/,
    ],
  },
  {
    slotId: "jacket",
    roles: ["outerwear", "jacket", "coat", "layer"],
    types: [
      /\bjacket\b/,
      /\bcoat\b/,
      /blazer/,
      /overshirt/,
      /cardigan/,
      /suit\s*jacket/,
      /gilet/,
      /waistcoat/,
      /vest/,
    ],
  },
  {
    slotId: "belt",
    roles: ["belt"],
    types: [/\bbelt\b/],
  },
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

/**
 * Map a catalog item to a hero slot, or null when unmapped (strip-only).
 * Prefers outfitRole substring/synonym, then type regex.
 * Belt is a hero accessory (drawn in the trousers waist band), not strip-only.
 */
export function itemToSlot(item) {
  const role = normalize(item && item.outfitRole);
  const type = normalize(item && item.type);

  for (const def of SLOT_SYNONYMS) {
    for (const token of def.roles) {
      if (role === token || (role && role.includes(token))) {
        return def.slotId;
      }
    }
  }

  for (const def of SLOT_SYNONYMS) {
    for (const re of def.types) {
      if ((type && re.test(type)) || (role && re.test(role))) {
        return def.slotId;
      }
    }
  }

  return null;
}

function firstPhoto(item) {
  return ((item && item.photos) || []).find(
    (p) => p && (p.url || p.thumbUrl || p.cutoutUrl)
  );
}

function stripThumbUrl(item) {
  const photo = ((item && item.photos) || []).find((p) => p && (p.thumbUrl || p.url));
  if (!photo) return "";
  return photo.thumbUrl || photo.url || "";
}

/**
 * Image URL policy (Option D / stop cutouts).
 * hero/catalog → photographic full, else thumb (never prefer cutout).
 * strip → always photographic thumb / original.
 */
export function layerImageUrl(item, { purpose = "hero" } = {}) {
  if (purpose === "strip") {
    return stripThumbUrl(item);
  }
  const photo = firstPhoto(item);
  if (!photo) return "";
  // Prefer originals/thumbs everywhere cutouts were preferred.
  return photo.url || photo.thumbUrl || "";
}

function itemLabel(item) {
  const type = String((item && item.type) || "item").trim();
  const brand = String((item && item.brandModel) || "").trim();
  const color = String((item && item.color) || "").trim();
  const bits = [color, type, brand].filter(Boolean);
  return bits.join(" ") || type;
}

function makeLayer(item, slotId, { hero }) {
  const band = slotId && SLOT_BANDS[slotId] ? { ...SLOT_BANDS[slotId] } : null;
  const inset = slotId && SLOT_INSET[slotId] ? { ...SLOT_INSET[slotId] } : null;
  const colorRaw = String((item && item.color) || "").trim();
  const patternRaw = String((item && item.pattern) || "").trim();
  return {
    itemId: String((item && (item.itemId || item.id)) || ""),
    slotId,
    zIndex: slotId && SLOT_Z[slotId] != null ? SLOT_Z[slotId] : 0,
    imageUrl: layerImageUrl(item, { purpose: "hero" }),
    thumbUrl: layerImageUrl(item, { purpose: "strip" }),
    fillColor: resolveFillColor(colorRaw),
    patternHint: resolvePatternHint(patternRaw),
    colorLabel: colorRaw,
    label: itemLabel(item),
    band,
    inset,
    hero: Boolean(hero),
  };
}

/**
 * Build hero layers + authenticity strip for one suggest look.
 * Duplicate slots: first wins for hero; losers and unmapped go strip-only.
 * Belt (if present) is exposed as `belt` for the trousers waist band.
 */
export function buildLookVisual(look, lookIndex = 0) {
  const items = (look && look.items) || [];
  const claimed = new Set();
  const layersBySlot = {};
  const stripOnly = [];
  let belt = null;

  for (const item of items) {
    const slotId = itemToSlot(item);
    if (!slotId) {
      stripOnly.push(makeLayer(item, null, { hero: false }));
      continue;
    }
    if (slotId === "belt") {
      if (!belt) {
        belt = makeLayer(item, "belt", { hero: true });
      } else {
        stripOnly.push(makeLayer(item, "belt", { hero: false }));
      }
      continue;
    }
    if (claimed.has(slotId)) {
      stripOnly.push(makeLayer(item, slotId, { hero: false }));
      continue;
    }
    claimed.add(slotId);
    layersBySlot[slotId] = makeLayer(item, slotId, { hero: true });
  }

  const layers = HERO_SLOT_ORDER.map((id) => layersBySlot[id]).filter(Boolean);

  const strip = [];
  for (const id of STRIP_SLOT_ORDER) {
    if (layersBySlot[id]) strip.push(layersBySlot[id]);
  }
  if (belt) strip.push(belt);
  for (const extra of stripOnly) {
    strip.push(extra);
  }

  return {
    lookIndex,
    layers,
    strip,
    belt,
  };
}
