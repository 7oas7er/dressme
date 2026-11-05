/**
 * Layered look layout (Option 4 chrome + Option 1 photo bands).
 * Slot synonyms + hero/strip view-model for suggest cards.
 * Cutout preference (B2/UC-24): hero/catalog use cutoutUrl when present.
 */

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
 * Vertical bands as % of the hero frame.
 * Tuned so shoes + lower trousers stay readable under a frontmost jacket
 * (design §3.1 with B3 polish — jacket no longer covers ~half the frame).
 */
export const SLOT_BANDS = {
  shoes: { topPct: 70, heightPct: 30 },
  trousers: { topPct: 36, heightPct: 44 },
  shirt: { topPct: 10, heightPct: 40 },
  jacket: { topPct: 2, heightPct: 34 },
};

/**
 * Horizontal inset (% of hero width) — silhouette so shoes sit narrower
 * than jacket/shirt and the stack reads as one body.
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
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

/**
 * Map a catalog item to a hero slot, or null when unmapped (strip-only).
 * Prefers outfitRole substring/synonym, then type regex.
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
    (p) => p && (p.cutoutUrl || p.url || p.thumbUrl)
  );
}

function stripThumbUrl(item) {
  const photo = ((item && item.photos) || []).find((p) => p && (p.thumbUrl || p.url));
  if (!photo) return "";
  return photo.thumbUrl || photo.url || "";
}

/**
 * Image URL policy (design §4.3 / §7).
 * hero/catalog → cutout if present, else full, else thumb.
 * strip → always photographic thumb / original (not matte).
 */
export function layerImageUrl(item, { purpose = "hero" } = {}) {
  if (purpose === "strip") {
    return stripThumbUrl(item);
  }
  const photo = firstPhoto(item);
  if (!photo) return "";
  if (photo.cutoutUrl) return photo.cutoutUrl;
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
  return {
    itemId: String((item && (item.itemId || item.id)) || ""),
    slotId,
    zIndex: slotId ? SLOT_Z[slotId] : 0,
    imageUrl: layerImageUrl(item, { purpose: "hero" }),
    thumbUrl: layerImageUrl(item, { purpose: "strip" }),
    label: itemLabel(item),
    band,
    inset,
    hero: Boolean(hero),
  };
}

/**
 * Build hero layers + authenticity strip for one suggest look.
 * Duplicate slots: first wins for hero; losers and unmapped go strip-only.
 */
export function buildLookVisual(look, lookIndex = 0) {
  const items = (look && look.items) || [];
  const claimed = new Set();
  const layersBySlot = {};
  const stripOnly = [];

  for (const item of items) {
    const slotId = itemToSlot(item);
    if (!slotId) {
      stripOnly.push(makeLayer(item, null, { hero: false }));
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
  for (const extra of stripOnly) {
    strip.push(extra);
  }

  return {
    lookIndex,
    layers,
    strip,
  };
}
