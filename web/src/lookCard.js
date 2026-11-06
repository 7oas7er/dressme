/**
 * Presentational look card: Option D SVG mannequin hero (left) +
 * authenticity strip of photographic thumbs (right).
 */

import { buildLookVisual } from "./lookLayout.js";
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

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.setAttribute("class", value);
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function patternId(lookIndex, slotId, hint) {
  return `mn-pat-${lookIndex}-${slotId}-${hint || "solid"}`;
}

function ensurePatternDefs(defs, lookIndex, layer) {
  if (!layer || !layer.patternHint || layer.patternHint === "solid") return null;
  const id = patternId(lookIndex, layer.slotId, layer.patternHint);
  // Avoid CSS.escape — keep ids simple ([A-Za-z0-9_-]) for DOM stubs / older engines.
  if (defs.querySelector(`#${id}`)) return `url(#${id})`;
  const fill = layer.fillColor || "#9aa3ad";
  if (layer.patternHint === "stripe") {
    defs.append(
      svgEl("pattern", {
        id,
        width: "8",
        height: "8",
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(28)",
      }, [
        svgEl("rect", { width: "8", height: "8", fill }),
        svgEl("rect", {
          x: "0",
          y: "0",
          width: "3",
          height: "8",
          fill: "rgba(255,255,255,0.28)",
        }),
      ])
    );
  } else if (layer.patternHint === "check") {
    defs.append(
      svgEl("pattern", {
        id,
        width: "10",
        height: "10",
        patternUnits: "userSpaceOnUse",
      }, [
        svgEl("rect", { width: "10", height: "10", fill }),
        svgEl("rect", {
          x: "0",
          y: "0",
          width: "5",
          height: "5",
          fill: "rgba(0,0,0,0.18)",
        }),
        svgEl("rect", {
          x: "5",
          y: "5",
          width: "5",
          height: "5",
          fill: "rgba(0,0,0,0.18)",
        }),
      ])
    );
  }
  return `url(#${id})`;
}

function panelFill(defs, lookIndex, layer) {
  if (!layer) return "transparent";
  const pat = ensurePatternDefs(defs, lookIndex, layer);
  return pat || layer.fillColor || "#9aa3ad";
}

/**
 * Standing silhouette with role-shaped panels.
 * Paint order (depth): shoes → trousers → shirt → jacket; belt in trousers band.
 */
function renderMannequinSvg(visual, lookIndex) {
  const bySlot = Object.fromEntries(
    (visual.layers || []).map((l) => [l.slotId, l])
  );
  const svg = svgEl("svg", {
    className: "look-mannequin",
    viewBox: "0 0 120 200",
    role: "img",
    "aria-label": "Outfit silhouette",
  });
  const defs = svgEl("defs");
  svg.append(defs);

  // Subtle body guide (never the glance signal).
  svg.append(
    svgEl("ellipse", {
      className: "mannequin-head",
      cx: "60",
      cy: "16",
      rx: "11",
      ry: "13",
    })
  );
  svg.append(
    svgEl("path", {
      className: "mannequin-guide",
      d: "M48 30 C48 28 72 28 72 30 L76 48 L44 48 Z",
    })
  );

  // Shoes (back-most of garments visually at feet).
  if (bySlot.shoes) {
    const fill = panelFill(defs, lookIndex, bySlot.shoes);
    svg.append(
      svgEl("path", {
        className: "mannequin-panel mannequin-shoes",
        "data-slot": "shoes",
        "data-item-id": bySlot.shoes.itemId || "",
        fill,
        d: "M28 178 C28 170 42 168 48 172 L52 188 C40 192 26 190 28 178 Z M92 178 C92 170 78 168 72 172 L68 188 C80 192 94 190 92 178 Z",
      })
    );
  }

  // Trousers.
  if (bySlot.trousers) {
    const fill = panelFill(defs, lookIndex, bySlot.trousers);
    svg.append(
      svgEl("path", {
        className: "mannequin-panel mannequin-trousers",
        "data-slot": "trousers",
        "data-item-id": bySlot.trousers.itemId || "",
        fill,
        d: "M42 88 L78 88 L82 170 L66 174 L60 118 L54 174 L38 170 Z",
      })
    );
  }

  // Belt in trousers waist band (attribute color when present).
  const beltLayer = visual.belt || null;
  if (bySlot.trousers || beltLayer) {
    const beltFill = beltLayer
      ? panelFill(defs, lookIndex, beltLayer)
      : "rgba(30,30,30,0.35)";
    svg.append(
      svgEl("rect", {
        className: "mannequin-panel mannequin-belt",
        "data-slot": "belt",
        "data-item-id": (beltLayer && beltLayer.itemId) || "",
        x: "41",
        y: "86",
        width: "38",
        height: "6",
        rx: "1.5",
        fill: beltFill,
      })
    );
  }

  // Shirt (under jacket).
  if (bySlot.shirt) {
    const fill = panelFill(defs, lookIndex, bySlot.shirt);
    svg.append(
      svgEl("path", {
        className: "mannequin-panel mannequin-shirt",
        "data-slot": "shirt",
        "data-item-id": bySlot.shirt.itemId || "",
        fill,
        d: "M46 32 L74 32 L78 90 L42 90 Z",
      })
    );
  }

  // Jacket (front-most torso).
  if (bySlot.jacket) {
    const fill = panelFill(defs, lookIndex, bySlot.jacket);
    svg.append(
      svgEl("path", {
        className: "mannequin-panel mannequin-jacket",
        "data-slot": "jacket",
        "data-item-id": bySlot.jacket.itemId || "",
        fill,
        d: "M38 30 L50 30 L54 48 L50 92 L34 88 L30 52 Z M82 30 L70 30 L66 48 L70 92 L86 88 L90 52 Z M50 30 L70 30 L72 48 L48 48 Z",
        "fill-opacity": "0.92",
      })
    );
  }

  return svg;
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
 * Build one look card DOM node (SVG mannequin hero + right authenticity strip).
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
    className: "look-hero look-hero--mannequin",
    "aria-label": "Assembled outfit",
  });

  if (!visual.layers.length && !visual.belt) {
    hero.append(
      el("p", {
        className: "muted look-hero-empty",
        text: visual.strip.length
          ? "No layerable pieces for this look — see originals on the right."
          : "Add more catalog pieces with outfit roles to fill this look.",
      })
    );
  } else {
    hero.append(renderMannequinSvg(visual, index));
  }

  const strip = el("div", {
    className: "look-strip",
    role: "list",
    "aria-label": "Original item photos",
  });
  if (!visual.strip.length) {
    strip.append(el("p", { className: "muted", text: "No photos" }));
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
