import assert from "node:assert/strict";
import test from "node:test";
import { catalogCardSubLine } from "../../web/src/catalog.js";

test("catalogCardSubLine prefers Brand · Wada English name", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "Pierre Cardin",
      color: "black",
      wadaColorIds: ["wada:v1:0"],
      outfitRole: "belt",
    }),
    "Pierre Cardin · Hermosa Pink"
  );
});

test("catalogCardSubLine falls back to free-text color when no Wada", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "Pierre Cardin",
      color: "Black",
      wadaColorIds: [],
      outfitRole: "belt",
    }),
    "Pierre Cardin · Black"
  );
});

test("catalogCardSubLine omits empty brand (color only)", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "  ",
      color: "navy",
      wadaColorIds: [],
    }),
    "navy"
  );
  assert.equal(
    catalogCardSubLine({
      brandModel: "",
      color: "olive",
      wadaColorIds: ["wada:v1:0"],
    }),
    "Hermosa Pink"
  );
});

test("catalogCardSubLine never includes outfitRole", () => {
  const line = catalogCardSubLine({
    brandModel: "Alden",
    color: "brown",
    outfitRole: "footwear",
  });
  assert.equal(line, "Alden · brown");
  assert.ok(!/footwear/.test(line));
});

test("catalogCardSubLine handles missing color and brand", () => {
  assert.equal(catalogCardSubLine({ brandModel: "Drake's", color: "" }), "Drake's");
  assert.equal(catalogCardSubLine({ brandModel: "", color: "" }), "");
  assert.equal(catalogCardSubLine(null), "");
});
