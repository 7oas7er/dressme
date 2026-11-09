import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLookVisual,
  itemToSlot,
  layerImageUrl,
  HERO_SLOT_ORDER,
  STRIP_SLOT_ORDER,
  SLOT_BANDS,
} from "../../web/src/lookLayout.js";
import {
  resolveFillColor,
  resolvePatternHint,
} from "../../web/src/mannequinColor.js";
import { renderLookCard } from "../../web/src/lookCard.js";
import { sampleThumb } from "../../web/src/thumbSample.js";

function photo(full, thumb, cutout) {
  const p = {};
  if (full) p.url = full;
  if (thumb) p.thumbUrl = thumb;
  if (cutout) p.cutoutUrl = cutout;
  return p;
}

function item(partial) {
  return {
    itemId: partial.itemId || "id",
    type: partial.type || "",
    outfitRole: partial.outfitRole || "",
    pattern: partial.pattern || "",
    brandModel: partial.brandModel || "",
    wadaColorIds: partial.wadaColorIds || [],
    photos: partial.photos || [photo("https://f.example/a.jpg", "https://t.example/a.jpg")],
    ...partial,
  };
}

/** Minimal DOM stub so lookCard can build structure without jsdom. */
function installDomStub() {
  class Node {
    constructor() {
      this.childNodes = [];
      this.nodeType = 1;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n == null) continue;
        this.childNodes.push(n.nodeType ? n : { nodeType: 3, textContent: String(n) });
      }
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        if (node.nodeType !== 1) return;
        if (matches(node, sel)) out.push(node);
        for (const c of node.childNodes) walk(c);
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
  }

  function matches(node, sel) {
    if (sel.startsWith(".")) {
      return (node.className || "").split(/\s+/).includes(sel.slice(1));
    }
    if (sel.startsWith("#")) {
      return node.attributes && node.attributes.id === sel.slice(1);
    }
    return node.tagName === sel.toUpperCase();
  }

  class El extends Node {
    constructor(tag) {
      super();
      this.tagName = String(tag).toUpperCase();
      this.className = "";
      this.textContent = "";
      this.attributes = {};
      this._listeners = {};
      this.style = { cssText: "" };
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key === "class") this.className = String(value);
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    addEventListener(type, fn) {
      this._listeners[type] = fn;
    }
  }

  globalThis.document = {
    createElement(tag) {
      return new El(tag);
    },
    createElementNS(_ns, tag) {
      return new El(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };
}

test("itemToSlot prefers outfitRole synonyms then type", () => {
  assert.equal(itemToSlot({ outfitRole: "outerwear", type: "blazer" }), "jacket");
  assert.equal(itemToSlot({ outfitRole: "base", type: "oxford" }), "shirt");
  assert.equal(itemToSlot({ outfitRole: "footwear", type: "derby" }), "shoes");
  assert.equal(itemToSlot({ outfitRole: "bottoms", type: "chinos" }), "trousers");
  assert.equal(itemToSlot({ outfitRole: "belt", type: "belt" }), "belt");
  assert.equal(itemToSlot({ outfitRole: "", type: "sneakers" }), "shoes");
  assert.equal(itemToSlot({ outfitRole: "", type: "trainers" }), "shoes");
  assert.equal(itemToSlot({ outfitRole: "", type: "denim" }), "trousers");
  assert.equal(itemToSlot({ outfitRole: "", type: "overshirt" }), "jacket");
  assert.equal(itemToSlot({ outfitRole: "", type: "waistcoat" }), "jacket");
  assert.equal(itemToSlot({ outfitRole: "misc", type: "watch" }), null);
});

test("hero bands keep shoes below jacket (SVG depth order)", () => {
  const jacketBottom = SLOT_BANDS.jacket.topPct + SLOT_BANDS.jacket.heightPct;
  const shoesTop = SLOT_BANDS.shoes.topPct;
  assert.ok(
    jacketBottom < shoesTop,
    "jacket band must not cover the shoe band"
  );
});

test("resolveFillColor maps wardrobe names; resolvePatternHint is cheap", () => {
  assert.equal(resolveFillColor("navy"), "#1e3a5f");
  assert.equal(resolveFillColor("#abc"), "#abc");
  assert.equal(resolvePatternHint("pinstripe"), "stripe");
  assert.equal(resolvePatternHint("glen check"), "check");
  assert.equal(resolvePatternHint("solid"), "solid");
});

test("layerImageUrl: hero/catalog prefer full → thumb (never cutout); strip uses thumb", () => {
  const withCutout = item({
    photos: [photo("https://f.example/a.jpg", "https://t.example/a.jpg", "https://c.example/a.webp")],
  });
  assert.equal(layerImageUrl(withCutout, { purpose: "hero" }), "https://f.example/a.jpg");
  assert.equal(layerImageUrl(withCutout, { purpose: "catalog" }), "https://f.example/a.jpg");
  assert.equal(layerImageUrl(withCutout, { purpose: "strip" }), "https://t.example/a.jpg");

  const fullOnly = item({ photos: [photo("https://f.example/b.jpg", "https://t.example/b.jpg")] });
  assert.equal(layerImageUrl(fullOnly, { purpose: "hero" }), "https://f.example/b.jpg");
  assert.equal(layerImageUrl(fullOnly, { purpose: "strip" }), "https://t.example/b.jpg");

  const thumbOnly = item({ photos: [{ thumbUrl: "https://t.example/c.jpg" }] });
  assert.equal(layerImageUrl(thumbOnly, { purpose: "hero" }), "https://t.example/c.jpg");
});

test("catalog layerImageUrl follows photos[0] after primary reorder", () => {
  const before = item({
    photos: [
      photo("https://f.example/first.jpg", "https://t.example/first.jpg"),
      photo("https://f.example/second.jpg", "https://t.example/second.jpg"),
    ],
  });
  assert.equal(layerImageUrl(before, { purpose: "catalog" }), "https://f.example/first.jpg");

  const after = item({
    photos: [
      photo("https://f.example/second.jpg", "https://t.example/second.jpg"),
      photo("https://f.example/first.jpg", "https://t.example/first.jpg"),
    ],
  });
  assert.equal(layerImageUrl(after, { purpose: "catalog" }), "https://f.example/second.jpg");
});

test("buildLookVisual orders hero by z-index and strip top-down; Wada fills when set", () => {
  const look = {
    items: [
      item({
        itemId: "sh",
        outfitRole: "footwear",
        type: "shoes",
        wadaColorIds: ["wada:v1:42"],
      }),
      item({
        itemId: "tr",
        outfitRole: "trousers",
        type: "pants",
        pattern: "solid",
        wadaColorIds: ["wada:v1:7"],
      }),
      item({
        itemId: "si",
        outfitRole: "shirt",
        type: "oxford",
        pattern: "stripe",
        wadaColorIds: ["wada:v1:0"],
      }),
      item({
        itemId: "jk",
        outfitRole: "outerwear",
        type: "blazer",
        wadaColorIds: ["wada:v1:0"],
      }),
      item({
        itemId: "be",
        outfitRole: "belt",
        type: "belt",
        wadaColorIds: ["wada:v1:42"],
      }),
    ],
  };
  const visual = buildLookVisual(look, 0);
  assert.deepEqual(
    visual.layers.map((l) => l.slotId),
    HERO_SLOT_ORDER
  );
  assert.ok(visual.layers[0].zIndex < visual.layers[3].zIndex);
  assert.deepEqual(
    visual.strip.map((l) => l.slotId),
    [...STRIP_SLOT_ORDER, "belt"]
  );
  assert.equal(visual.layers[3].imageUrl, "https://f.example/a.jpg");
  assert.equal(visual.strip[0].thumbUrl, "https://t.example/a.jpg");
  assert.equal(visual.layers.find((l) => l.slotId === "jacket").fillColor, "#f9c1ce");
  assert.equal(visual.layers.find((l) => l.slotId === "shirt").patternHint, "stripe");
  assert.ok(visual.belt);
  assert.equal(visual.belt.itemId, "be");
  assert.equal(visual.belt.fillColor, "#fdd4bd");
});

test("Option D uses primary Wada hex when set", () => {
  const look = {
    items: [
      item({
        itemId: "jk",
        outfitRole: "outerwear",
        type: "blazer",
        wadaColorIds: ["wada:v1:0"],
      }),
    ],
  };
  const visual = buildLookVisual(look, 0);
  const jacket = visual.layers.find((l) => l.slotId === "jacket");
  assert.equal(jacket.fillColor, "#f9c1ce");
  assert.equal(jacket.fillFromWada, true);
});

test("without Wada, fillFromWada is false and neutral fallback applies", () => {
  const look = {
    items: [
      item({
        itemId: "jk",
        outfitRole: "outerwear",
        type: "blazer",
        wadaColorIds: [],
      }),
    ],
  };
  const visual = buildLookVisual(look, 0);
  const jacket = visual.layers.find((l) => l.slotId === "jacket");
  assert.equal(jacket.fillColor, "#9aa3ad");
  assert.equal(jacket.fillFromWada, false);
});

test("unmapped items are strip-only; duplicate slots keep first for hero", () => {
  const look = {
    items: [
      item({ itemId: "j1", outfitRole: "outerwear", type: "blazer" }),
      item({ itemId: "j2", outfitRole: "jacket", type: "coat" }),
      item({ itemId: "acc", outfitRole: "accessory", type: "watch" }),
      item({ itemId: "sh", outfitRole: "base", type: "shirt" }),
    ],
  };
  const visual = buildLookVisual(look);
  assert.deepEqual(
    visual.layers.map((l) => l.itemId),
    ["sh", "j1"]
  );
  assert.equal(visual.layers.find((l) => l.slotId === "jacket").itemId, "j1");
  const stripIds = visual.strip.map((l) => l.itemId);
  assert.ok(stripIds.includes("j1"));
  assert.ok(stripIds.includes("j2"));
  assert.ok(stripIds.includes("acc"));
  assert.ok(stripIds.includes("sh"));
  assert.equal(visual.strip.find((l) => l.itemId === "j2").hero, false);
  assert.equal(visual.strip.find((l) => l.itemId === "acc").slotId, null);
});

test("renderLookCard DOM is photos-only with Wada plate and tappable pieces", () => {
  installDomStub();
  const look = {
    lookId: "1",
    title: "Soft Navy Stack",
    rationale: "Navy blazer over a white oxford keeps the lunch formal without black-tie overreach.",
    items: [
      item({
        itemId: "jk",
        outfitRole: "outerwear",
        type: "blazer",
        wadaColorIds: ["wada:v1:42"],
      }),
      item({ itemId: "si", outfitRole: "shirt", type: "oxford", pattern: "stripe" }),
      item({
        itemId: "tr",
        outfitRole: "trousers",
        type: "pants",
        wadaColorIds: ["wada:v1:7"],
      }),
      item({ itemId: "sh", outfitRole: "footwear", type: "shoes" }),
      item({ itemId: "be", outfitRole: "belt", type: "belt" }),
    ],
  };
  let opened = null;
  const card = renderLookCard(look, 0, {
    onItemOpen: (piece) => {
      opened = piece;
    },
  });
  assert.equal(card.className, "look-card");
  assert.match(card.querySelector("h2").textContent || "", /Soft Navy Stack/);
  assert.ok(card.querySelector(".look-body"));
  assert.equal(card.querySelector(".look-mannequin"), null);
  assert.equal(card.querySelector(".look-hero"), null);
  assert.ok(card.querySelector(".look-wada-plate"));
  assert.ok(card.querySelectorAll(".look-wada-swatch").length >= 1);
  assert.ok(card.querySelector(".look-pieces"));
  assert.equal(card.querySelectorAll(".look-piece").length, 5);
  assert.ok(card.querySelectorAll(".look-piece-btn").length >= 1);
  const rationale = card.querySelector(".look-rationale");
  assert.ok(rationale);
  assert.match(rationale.textContent || "", /Navy blazer/);
  assert.equal(card.querySelector(".look-pieces .look-rationale"), null);

  const btn = card.querySelector(".look-piece-btn");
  assert.ok(btn && btn._listeners && btn._listeners.click);
  btn._listeners.click();
  assert.ok(opened);
  assert.ok(opened.itemId);

  const noRationale = renderLookCard({ lookId: "2", items: look.items }, 1);
  assert.equal(noRationale.querySelector(".look-rationale"), null);
  delete globalThis.document;
});

test("sampleThumb no-ops without canvas/Image (Node unit)", async () => {
  const result = await sampleThumb("https://t.example/a.jpg");
  assert.equal(result, null);
});
