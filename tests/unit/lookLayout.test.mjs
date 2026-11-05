import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLookVisual,
  itemToSlot,
  layerImageUrl,
  HERO_SLOT_ORDER,
  STRIP_SLOT_ORDER,
} from "../../web/src/lookLayout.js";
import { renderLookCard } from "../../web/src/lookCard.js";

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
    color: partial.color || "",
    brandModel: partial.brandModel || "",
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
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
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
  assert.equal(itemToSlot({ outfitRole: "", type: "sneakers" }), "shoes");
  assert.equal(itemToSlot({ outfitRole: "", type: "overshirt" }), "jacket");
  assert.equal(itemToSlot({ outfitRole: "misc", type: "watch" }), null);
});

test("layerImageUrl: hero prefers cutout → full → thumb; strip uses thumb", () => {
  const withCutout = item({
    photos: [photo("https://f.example/a.jpg", "https://t.example/a.jpg", "https://c.example/a.webp")],
  });
  assert.equal(layerImageUrl(withCutout, { purpose: "hero" }), "https://c.example/a.webp");
  assert.equal(layerImageUrl(withCutout, { purpose: "strip" }), "https://t.example/a.jpg");

  const fullOnly = item({ photos: [photo("https://f.example/b.jpg", "https://t.example/b.jpg")] });
  assert.equal(layerImageUrl(fullOnly, { purpose: "hero" }), "https://f.example/b.jpg");
  assert.equal(layerImageUrl(fullOnly, { purpose: "strip" }), "https://t.example/b.jpg");

  const thumbOnly = item({ photos: [{ thumbUrl: "https://t.example/c.jpg" }] });
  assert.equal(layerImageUrl(thumbOnly, { purpose: "hero" }), "https://t.example/c.jpg");
});

test("buildLookVisual orders hero by z-index and strip top-down", () => {
  const look = {
    items: [
      item({ itemId: "sh", outfitRole: "footwear", type: "shoes" }),
      item({ itemId: "tr", outfitRole: "trousers", type: "pants" }),
      item({ itemId: "si", outfitRole: "shirt", type: "oxford" }),
      item({ itemId: "jk", outfitRole: "outerwear", type: "blazer" }),
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
    STRIP_SLOT_ORDER
  );
  assert.equal(visual.layers[3].imageUrl, "https://f.example/a.jpg");
  assert.equal(visual.strip[0].thumbUrl, "https://t.example/a.jpg");
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

test("renderLookCard DOM has hero + right strip structure", () => {
  installDomStub();
  const look = {
    lookId: "1",
    items: [
      item({ itemId: "jk", outfitRole: "outerwear", type: "blazer", color: "navy" }),
      item({ itemId: "si", outfitRole: "shirt", type: "oxford", color: "white" }),
      item({ itemId: "tr", outfitRole: "trousers", type: "pants", color: "grey" }),
      item({ itemId: "sh", outfitRole: "footwear", type: "shoes", color: "brown" }),
    ],
  };
  const card = renderLookCard(look, 0);
  assert.equal(card.className, "look-card");
  assert.ok(card.querySelector(".look-body"));
  assert.ok(card.querySelector(".look-hero"));
  assert.ok(card.querySelector(".look-strip"));
  assert.equal(card.querySelectorAll(".look-layer").length, 4);
  assert.equal(card.querySelectorAll(".look-strip-thumb").length, 4);
  const body = card.querySelector(".look-body");
  assert.equal(body.children[0].className, "look-hero");
  assert.equal(body.children[1].className, "look-strip");
  delete globalThis.document;
});
