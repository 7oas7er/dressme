/**
 * Presentational look card: layered hero (left) + authenticity strip (right).
 * Display-only strip/hero taps in B1.
 */

import { buildLookVisual, SLOT_COMPOSITE } from "./lookLayout.js";
import { lookHeadline, lookSummary } from "./suggest.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value != null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function renderHeroLayer(layer) {
  const band = layer.band || { topPct: 30, heightPct: 30 };
  const inset = layer.inset || { leftPct: 8, rightPct: 8 };
  const composite =
    (layer.slotId && SLOT_COMPOSITE[layer.slotId]) || null;
  const styleParts = [
    `top:${band.topPct}%`,
    `height:${band.heightPct}%`,
    `left:${inset.leftPct}%`,
    `right:${inset.rightPct}%`,
    `z-index:${layer.zIndex}`,
  ];
  if (composite && composite.opacity != null) {
    styleParts.push(`opacity:${composite.opacity}`);
  }
  const node = el("div", {
    className: `look-layer look-layer--${layer.slotId || "other"}`,
    style: styleParts.join(";"),
    "data-slot": layer.slotId || "",
    "data-item-id": layer.itemId || "",
  });
  if (layer.imageUrl) {
    node.append(
      el("img", {
        src: layer.imageUrl,
        alt: layer.label || "outfit piece",
        loading: "lazy",
      })
    );
  } else {
    node.append(el("div", { className: "look-layer-empty", text: "No photo" }));
  }
  return node;
}

function renderStripThumb(layer) {
  const fig = el("figure", {
    className: "look-strip-thumb",
    "data-slot": layer.slotId || "",
    "data-item-id": layer.itemId || "",
    "data-hero": layer.hero ? "1" : "0",
  });
  if (layer.thumbUrl) {
    fig.append(
      el("img", {
        src: layer.thumbUrl,
        alt: layer.label || "catalog photo",
        loading: "lazy",
      })
    );
  } else {
    fig.append(el("div", { className: "thumb", text: "—" }));
  }
  return fig;
}

/**
 * Build one look card DOM node (hero compositor + right authenticity strip).
 */
export function renderLookCard(look, index = 0) {
  const visual = buildLookVisual(look, index);
  const lookEl = el("article", {
    className: "look-card",
    "aria-label": lookHeadline(look, index),
  });
  lookEl.append(el("h2", { text: lookHeadline(look, index) }));
  lookEl.append(
    el("p", { className: "muted look-summary", text: lookSummary(look) })
  );

  const body = el("div", {
    className: "look-body",
    role: "group",
    "aria-label": `${lookHeadline(look, index)} layered look`,
  });

  const hero = el("div", {
    className: "look-hero",
    "aria-label": "Assembled outfit",
  });

  if (!visual.layers.length) {
    hero.append(
      el("p", {
        className: "muted look-hero-empty",
        text: visual.strip.length
          ? "No layerable pieces for this look — see originals on the right."
          : "Add more catalog pieces with outfit roles to fill this look.",
      })
    );
  } else {
    for (const layer of visual.layers) {
      hero.append(renderHeroLayer(layer));
    }
  }

  const strip = el("div", {
    className: "look-strip",
    role: "list",
    "aria-label": "Original item photos",
  });
  if (!visual.strip.length) {
    strip.append(
      el("p", { className: "muted", text: "No photos" })
    );
  } else {
    for (const layer of visual.strip) {
      const item = renderStripThumb(layer);
      item.setAttribute("role", "listitem");
      strip.append(item);
    }
  }

  body.append(hero, strip);
  lookEl.append(body);
  return lookEl;
}
