import assert from "node:assert/strict";
import test from "node:test";
import { catalogCardSubLine } from "../../web/src/catalog.js";

test("catalogCardSubLine prefers Brand · Wada English name", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "Pierre Cardin",
      wadaColorIds: ["wada:v1:0"],
      outfitRole: "belt",
    }),
    "Pierre Cardin · Hermosa Pink"
  );
});

test("catalogCardSubLine omits color segment when no Wada (no free-text fallback)", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "Pierre Cardin",
      color: "Black",
      wadaColorIds: [],
      outfitRole: "belt",
    }),
    "Pierre Cardin"
  );
});

test("catalogCardSubLine omits empty brand (Wada name only)", () => {
  assert.equal(
    catalogCardSubLine({
      brandModel: "  ",
      wadaColorIds: [],
    }),
    ""
  );
  assert.equal(
    catalogCardSubLine({
      brandModel: "",
      wadaColorIds: ["wada:v1:0"],
    }),
    "Hermosa Pink"
  );
});

test("catalogCardSubLine never includes outfitRole", () => {
  const line = catalogCardSubLine({
    brandModel: "Alden",
    wadaColorIds: ["wada:v1:0"],
    outfitRole: "footwear",
  });
  assert.equal(line, "Alden · Hermosa Pink");
  assert.ok(!/footwear/.test(line));
});

test("catalogCardSubLine handles missing Wada and brand", () => {
  assert.equal(catalogCardSubLine({ brandModel: "Drake's", wadaColorIds: [] }), "Drake's");
  assert.equal(catalogCardSubLine({ brandModel: "", wadaColorIds: [] }), "");
  assert.equal(catalogCardSubLine(null), "");
});
