/**
 * Presentational look card: Option D SVG mannequin hero (left) +
 * authenticity strip of photographic thumbs (right).
 * Phase 1: elongated male croquis, soft washes, optional thumb color/texture.
 */

import { buildLookVisual } from "./lookLayout.js";
import { lookHeadline, lookSummary } from "./suggest.js";
import { sampleThumb } from "./thumbSample.js";

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

/** Parse #rgb / #rrggbb → [r,g,b]; null when unparseable. */
function parseHex(color) {
  const s = String(color || "").trim();
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    const h = m3[1];
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  const m6 = /^#([0-9a-f]{6})$/i.exec(s);
  if (m6) {
    const h = m6[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

function toHex(r, g, b) {
  const h = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** amount ∈ [-1,1]; positive lightens. */
function shiftColor(color, amount) {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const [r, g, b] = rgb;
  if (amount >= 0) {
    return toHex(
      r + (255 - r) * amount,
      g + (255 - g) * amount,
      b + (255 - b) * amount
    );
  }
  const f = 1 + amount;
  return toHex(r * f, g * f, b * f);
}

function patternId(lookIndex, slotId, hint) {
  return `mn-pat-${lookIndex}-${slotId}-${hint || "solid"}`;
}

function washId(lookIndex, slotId) {
  return `mn-wash-${lookIndex}-${slotId}`;
}

function grainId(lookIndex) {
  return `mn-grain-${lookIndex}`;
}

function texPatId(lookIndex, slotId) {
  return `mn-tex-${lookIndex}-${slotId}`;
}

function ensureGrainFilter(defs, lookIndex) {
  const id = grainId(lookIndex);
  if (defs.querySelector(`#${id}`)) return id;
  defs.append(
    svgEl("filter", {
      id,
      x: "-5%",
      y: "-5%",
      width: "110%",
      height: "110%",
      "color-interpolation-filters": "sRGB",
    }, [
      svgEl("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: "0.9",
        numOctaves: "2",
        seed: String(3 + (lookIndex % 5)),
        result: "noise",
      }),
      svgEl("feColorMatrix", {
        in: "noise",
        type: "matrix",
        values: "0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0.22 0",
        result: "softNoise",
      }),
      svgEl("feBlend", {
        in: "SourceGraphic",
        in2: "softNoise",
        mode: "multiply",
      }),
    ])
  );
  return id;
}

function ensureWashGradient(defs, lookIndex, slotId, baseColor) {
  const id = washId(lookIndex, slotId);
  const existing = defs.querySelector(`#${id}`);
  const light = shiftColor(baseColor, 0.22);
  const mid = baseColor;
  const deep = shiftColor(baseColor, -0.28);
  if (existing) {
    const stops = existing.querySelectorAll("stop");
    if (stops[0]) stops[0].setAttribute("stop-color", light);
    if (stops[1]) stops[1].setAttribute("stop-color", mid);
    if (stops[2]) stops[2].setAttribute("stop-color", deep);
    return `url(#${id})`;
  }
  const grad = svgEl(
    "linearGradient",
    {
      id,
      x1: "12%",
      y1: "8%",
      x2: "88%",
      y2: "95%",
    },
    [
      svgEl("stop", { offset: "0%", "stop-color": light }),
      svgEl("stop", { offset: "48%", "stop-color": mid }),
      svgEl("stop", { offset: "100%", "stop-color": deep }),
    ]
  );
  defs.append(grad);
  return `url(#${id})`;
}

function ensurePatternDefs(defs, lookIndex, layer, baseColor) {
  if (!layer || !layer.patternHint || layer.patternHint === "solid") return null;
  const id = patternId(lookIndex, layer.slotId, layer.patternHint);
  const existing = defs.querySelector(`#${id}`);
  if (existing) {
    const rect = existing.querySelector("rect");
    if (rect) rect.setAttribute("fill", baseColor);
    return `url(#${id})`;
  }
  const fill = baseColor || "#9aa3ad";
  if (layer.patternHint === "stripe") {
    defs.append(
      svgEl(
        "pattern",
        {
          id,
          width: "8",
          height: "8",
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(28)",
        },
        [
          svgEl("rect", { width: "8", height: "8", fill }),
          svgEl("rect", {
            x: "0",
            y: "0",
            width: "3",
            height: "8",
            fill: "rgba(255,255,255,0.28)",
          }),
        ]
      )
    );
  } else if (layer.patternHint === "check") {
    defs.append(
      svgEl(
        "pattern",
        {
          id,
          width: "10",
          height: "10",
          patternUnits: "userSpaceOnUse",
        },
        [
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
        ]
      )
    );
  }
  return `url(#${id})`;
}

function ensureTexturePattern(defs, lookIndex, slotId, dataUrl) {
  if (!dataUrl) return null;
  const id = texPatId(lookIndex, slotId);
  const existing = defs.querySelector(`#${id}`);
  if (existing) {
    const img = existing.querySelector("image");
    if (img) img.setAttribute("href", dataUrl);
    return `url(#${id})`;
  }
  defs.append(
    svgEl(
      "pattern",
      {
        id,
        width: "28",
        height: "28",
        patternUnits: "userSpaceOnUse",
      },
      [
        svgEl("image", {
          href: dataUrl,
          width: "28",
          height: "28",
          preserveAspectRatio: "xMidYMid slice",
        }),
      ]
    )
  );
  return `url(#${id})`;
}

function panelBaseFill(defs, lookIndex, layer, baseColor) {
  if (!layer) return "transparent";
  const pat = ensurePatternDefs(defs, lookIndex, layer, baseColor);
  if (pat) return pat;
  return ensureWashGradient(defs, lookIndex, layer.slotId, baseColor);
}

/**
 * Elongated male croquis (~9-head fashion proportion) with role panels.
 * Blank/minimal face. Paint order: shoes → trousers → shirt → jacket; belt in waist.
 * viewBox taller than Phase 0 toy figure.
 */
function renderMannequinSvg(visual, lookIndex) {
  const bySlot = Object.fromEntries(
    (visual.layers || []).map((l) => [l.slotId, l])
  );
  const svg = svgEl("svg", {
    className: "look-mannequin",
    viewBox: "0 0 100 240",
    role: "img",
    "aria-label": "Outfit silhouette",
  });
  const defs = svgEl("defs");
  svg.append(defs);
  const grain = ensureGrainFilter(defs, lookIndex);

  const figure = svgEl("g", {
    className: "mannequin-figure",
    filter: `url(#${grain})`,
  });

  // Blank oval head + soft neck (no facial features).
  figure.append(
    svgEl("ellipse", {
      className: "mannequin-head",
      cx: "50",
      cy: "14",
      rx: "7.5",
      ry: "9",
    })
  );
  figure.append(
    svgEl("path", {
      className: "mannequin-guide",
      d: "M42 24 C42 22 58 22 58 24 L61 34 L39 34 Z",
    })
  );

  /** @type {Map<string, { panel: Element, washOverlay: Element | null, texOverlay: Element | null, pathD: string }>} */
  const panelRefs = new Map();

  function addPanel(slotId, layer, pathD, extraAttrs = {}) {
    if (!layer) return;
    const base = layer.fillColor || "#9aa3ad";
    // Keep wash gradient available even when pattern is the base fill.
    ensureWashGradient(defs, lookIndex, slotId, base);
    const fill = panelBaseFill(defs, lookIndex, layer, base);
    const panel = svgEl("path", {
      className: `mannequin-panel mannequin-${slotId}`,
      "data-slot": slotId,
      "data-item-id": layer.itemId || "",
      fill,
      d: pathD,
      ...extraAttrs,
    });
    figure.append(panel);

    let washOverlay = null;
    if (layer.patternHint && layer.patternHint !== "solid") {
      washOverlay = svgEl("path", {
        className: "mannequin-wash",
        "data-slot": slotId,
        d: pathD,
        fill: `url(#${washId(lookIndex, slotId)})`,
        "fill-opacity": "0.38",
        style: "mix-blend-mode: multiply",
        "pointer-events": "none",
      });
      figure.append(washOverlay);
    }

    const texOverlay = svgEl("path", {
      className: "mannequin-tex",
      "data-slot": slotId,
      d: pathD,
      fill: "none",
      "fill-opacity": "0",
      style: "mix-blend-mode: multiply",
      "pointer-events": "none",
    });
    figure.append(texOverlay);

    panelRefs.set(slotId, { panel, washOverlay, texOverlay, pathD, layer });
  }

  // Shoes — side profile with heel (left + right).
  if (bySlot.shoes) {
    addPanel(
      "shoes",
      bySlot.shoes,
      "M22 214 C22 208 30 205 38 207 L48 212 C50 214 49 218 46 220 L28 222 C22 221 20 218 22 214 Z M78 214 C78 208 70 205 62 207 L52 212 C50 214 51 218 54 220 L72 222 C78 221 80 218 78 214 Z"
    );
  }

  // Trousers — elongated legs, slight break at hem.
  if (bySlot.trousers) {
    addPanel(
      "trousers",
      bySlot.trousers,
      "M36 98 L64 98 L68 208 C66 214 58 216 54 212 L50 130 L46 212 C42 216 34 214 32 208 Z"
    );
  }

  // Belt in waist band.
  const beltLayer = visual.belt || null;
  if (bySlot.trousers || beltLayer) {
    const beltBase =
      (beltLayer && beltLayer.fillColor) || "rgba(30,30,30,0.45)";
    if (beltLayer) {
      ensureWashGradient(defs, lookIndex, "belt", beltLayer.fillColor || "#1a1a1a");
    }
    const beltFill = beltLayer
      ? panelBaseFill(defs, lookIndex, beltLayer, beltLayer.fillColor || "#1a1a1a")
      : beltBase;
    const belt = svgEl("rect", {
      className: "mannequin-panel mannequin-belt",
      "data-slot": "belt",
      "data-item-id": (beltLayer && beltLayer.itemId) || "",
      x: "35",
      y: "95",
      width: "30",
      height: "5",
      rx: "1.2",
      fill: beltFill,
    });
    figure.append(belt);
    if (beltLayer) {
      panelRefs.set("belt", {
        panel: belt,
        washOverlay: null,
        texOverlay: null,
        pathD: null,
        layer: beltLayer,
      });
    }
  }

  // Shirt — collar V hint, elongated torso under jacket.
  if (bySlot.shirt) {
    addPanel(
      "shirt",
      bySlot.shirt,
      "M40 36 L50 42 L60 36 L64 100 L36 100 Z"
    );
  }

  // Jacket — open fronts with lapel notches + soft shoulder.
  if (bySlot.jacket) {
    addPanel(
      "jacket",
      bySlot.jacket,
      // Left flap + lapel, right flap + lapel, shoulder bridge
      "M30 34 L42 34 L46 52 L42 108 L28 102 L24 56 Z M42 34 L48 38 L46 52 Z M70 34 L58 34 L54 52 L58 108 L72 102 L76 56 Z M58 34 L52 38 L54 52 Z M42 34 L58 34 L60 48 L40 48 Z",
      { "fill-opacity": "0.94" }
    );
  }

  svg.append(figure);

  // Async Path 4a: sample strip thumbs → update washes + light texture overlay.
  applyThumbSamples(defs, lookIndex, panelRefs);

  return svg;
}

function applyThumbSamples(defs, lookIndex, panelRefs) {
  for (const [slotId, ref] of panelRefs) {
    const url = ref.layer && ref.layer.thumbUrl;
    if (!url) continue;
    sampleThumb(url).then((sample) => {
      if (!sample || !sample.dominantHex) return;
      const color = sample.dominantHex;
      ref.layer.fillColor = color;
      ensureWashGradient(defs, lookIndex, slotId, color);
      const fill = panelBaseFill(defs, lookIndex, ref.layer, color);
      if (ref.panel) ref.panel.setAttribute("fill", fill);
      if (ref.washOverlay) {
        ref.washOverlay.setAttribute(
          "fill",
          `url(#${washId(lookIndex, slotId)})`
        );
      }
      if (ref.texOverlay && sample.textureDataUrl && ref.pathD) {
        const tex = ensureTexturePattern(
          defs,
          lookIndex,
          slotId,
          sample.textureDataUrl
        );
        if (tex) {
          ref.texOverlay.setAttribute("fill", tex);
          ref.texOverlay.setAttribute("fill-opacity", "0.28");
        }
      }
    }).catch(() => {
      /* attribute-map fill already painted */
    });
  }
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

  // UC-09: Bedrock rationale below hero+strip (never overlay the SVG).
  const rationale = String((look && look.rationale) || "").trim().slice(0, 400);
  if (rationale) {
    lookEl.append(
      el("p", {
        className: "look-rationale",
        text: rationale,
      })
    );
  }

  return lookEl;
}
