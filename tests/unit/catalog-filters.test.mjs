import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttributeFilters,
  collectAttributeFilterValues,
} from "../../web/src/catalog.js";

const sample = [
  {
    itemId: "1",
    type: "jacket",
    color: "navy",
    fabric: "wool",
    brandModel: "Drake's",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
  },
  {
    itemId: "2",
    type: "shirt",
    color: "white",
    fabric: "cotton",
    brandModel: "Drake's",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "base",
  },
  {
    itemId: "3",
    type: "jacket",
    color: "olive",
    fabric: "cotton",
    brandModel: "Private White V.C.",
    formality: "casual",
    pattern: "solid",
    season: "cool",
    outfitRole: "outerwear",
  },
];

test("collectAttributeFilterValues lists unique wardrobe values per category", () => {
  const options = collectAttributeFilterValues(sample);
  assert.deepEqual(options.type, ["jacket", "shirt"]);
  assert.deepEqual(options.color, ["navy", "olive", "white"]);
  assert.deepEqual(options.brandModel, ["Drake's", "Private White V.C."]);
  assert.deepEqual(options.outfitRole, ["base", "outerwear"]);
});

test("applyAttributeFilters ANDs across categories", () => {
  const jackets = applyAttributeFilters(sample, { type: "jacket" });
  assert.equal(jackets.length, 2);

  const navyJacket = applyAttributeFilters(sample, {
    type: "jacket",
    color: "navy",
  });
  assert.equal(navyJacket.length, 1);
  assert.equal(navyJacket[0].itemId, "1");

  const none = applyAttributeFilters(sample, {
    type: "jacket",
    fabric: "silk",
  });
  assert.equal(none.length, 0);
});

test("empty filters return the full catalog", () => {
  assert.equal(applyAttributeFilters(sample, {}).length, 3);
  assert.equal(
    applyAttributeFilters(sample, {
      type: "",
      color: "",
      fabric: "",
      brandModel: "",
      formality: "",
      pattern: "",
      season: "",
      outfitRole: "",
    }).length,
    3
  );
});
