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
    fabric: "wool",
    brandModel: "Drake's",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
    wadaColorIds: ["wada:v1:0"],
  },
  {
    itemId: "2",
    type: "shirt",
    fabric: "cotton",
    brandModel: "Drake's",
    formality: "business",
    pattern: "solid",
    season: "all-season",
    outfitRole: "base",
    wadaColorIds: ["wada:v1:42"],
  },
  {
    itemId: "3",
    type: "jacket",
    fabric: "cotton",
    brandModel: "Private White V.C.",
    formality: "casual",
    pattern: "solid",
    season: "cool",
    outfitRole: "outerwear",
    wadaColorIds: [],
  },
];

test("collectAttributeFilterValues lists unique wardrobe values per category", () => {
  const options = collectAttributeFilterValues(sample);
  assert.deepEqual(options.type, ["jacket", "shirt"]);
  // Color filter = primary Wada English names present in wardrobe.
  assert.deepEqual(options.color, ["Hermosa Pink", "Seashell Pink"]);
  assert.deepEqual(options.brandModel, ["Drake's", "Private White V.C."]);
  assert.deepEqual(options.outfitRole, ["base", "outerwear"]);
});

test("applyAttributeFilters ANDs across categories including Wada color", () => {
  const jackets = applyAttributeFilters(sample, { type: "jacket" });
  assert.equal(jackets.length, 2);

  const pinkJacket = applyAttributeFilters(sample, {
    type: "jacket",
    color: "Hermosa Pink",
  });
  assert.equal(pinkJacket.length, 1);
  assert.equal(pinkJacket[0].itemId, "1");

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
