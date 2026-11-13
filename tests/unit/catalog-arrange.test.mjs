import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGroupSort,
  arrangeActive,
  arrangeToggleLabel,
  berlinDayKey,
  defaultArrangePrefs,
  defaultSortDir,
  formalityRank,
  formatBerlinDayLabel,
  normalizeArrangePrefs,
  readArrangePrefs,
  writeArrangePrefs,
} from "../../web/src/catalogArrange.js";

const sample = [
  {
    itemId: "a",
    type: "shirt",
    brandModel: "Drake's",
    formality: "business",
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  },
  {
    itemId: "b",
    type: "jacket",
    brandModel: "Hiltl 10",
    formality: "casual",
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-13T10:00:00.000Z",
  },
  {
    itemId: "c",
    type: "jacket",
    brandModel: "Hiltl 2",
    formality: "weekend",
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
  },
  {
    itemId: "d",
    type: "",
    brandModel: "",
    formality: "",
    createdAt: "",
    updatedAt: "2026-11-09T10:00:00.000Z",
  },
  {
    itemId: "e",
    type: "shoes",
    brandModel: "Alden",
    formality: "black-tie",
    createdAt: "2026-11-08T10:00:00.000Z",
    updatedAt: "2026-11-14T10:00:00.000Z",
  },
];

test("formalityRank mirrors Suggest seed spellings", () => {
  assert.equal(formalityRank("black tie"), 5);
  assert.equal(formalityRank("black-tie"), 5);
  assert.equal(formalityRank("formal"), 4);
  assert.equal(formalityRank("business"), 3);
  assert.equal(formalityRank("smart casual"), 2);
  assert.equal(formalityRank("casual"), 1);
  assert.equal(formalityRank("weekend"), 1);
  assert.equal(formalityRank(""), 0);
  assert.equal(formalityRank("mystery"), 0);
});

test("normalizeArrangePrefs clamps invalid values", () => {
  assert.deepEqual(normalizeArrangePrefs(null), defaultArrangePrefs());
  assert.deepEqual(
    normalizeArrangePrefs({ groupBy: "nope", sortBy: "type", sortDir: "up" }),
    { groupBy: "none", sortBy: "type", sortDir: "asc" }
  );
});

test("defaultSortDir prefers newest / formal first for those dims", () => {
  assert.equal(defaultSortDir("dateAdded"), "desc");
  assert.equal(defaultSortDir("formality"), "desc");
  assert.equal(defaultSortDir("type"), "asc");
  assert.equal(defaultSortDir("brandModel"), "asc");
});

test("default prefs leave API order (flat, no rearrange)", () => {
  const result = applyGroupSort(sample, defaultArrangePrefs());
  assert.equal(result.mode, "flat");
  assert.deepEqual(
    result.items.map((i) => i.itemId),
    sample.map((i) => i.itemId)
  );
  assert.equal(arrangeActive(defaultArrangePrefs()), false);
});

test("sort by type asc puts empty last", () => {
  const result = applyGroupSort(sample, {
    groupBy: "none",
    sortBy: "type",
    sortDir: "asc",
  });
  assert.deepEqual(
    result.items.map((i) => i.itemId),
    ["b", "c", "a", "e", "d"]
  );
});

test("sort by dateAdded desc is newest-first; missing last", () => {
  const result = applyGroupSort(sample, {
    groupBy: "none",
    sortBy: "dateAdded",
    sortDir: "desc",
  });
  assert.deepEqual(
    result.items.map((i) => i.itemId),
    ["b", "c", "a", "e", "d"]
  );
});

test("sort by brandModel uses numeric-aware collation", () => {
  const result = applyGroupSort(sample, {
    groupBy: "none",
    sortBy: "brandModel",
    sortDir: "asc",
  });
  assert.deepEqual(
    result.items.map((i) => i.itemId),
    ["e", "a", "c", "b", "d"]
  );
});

test("sort by formality desc is formal→casual; unset last; weekend keeps label rank", () => {
  const result = applyGroupSort(sample, {
    groupBy: "none",
    sortBy: "formality",
    sortDir: "desc",
  });
  assert.deepEqual(
    result.items.map((i) => i.itemId),
    ["e", "a", "b", "c", "d"]
  );
  assert.equal(formalityRank("weekend"), formalityRank("casual"));
});

test("sort by formality asc still puts unset last", () => {
  const result = applyGroupSort(sample, {
    groupBy: "none",
    sortBy: "formality",
    sortDir: "asc",
  });
  assert.equal(result.items[result.items.length - 1].itemId, "d");
  assert.equal(result.items[0].itemId, "b");
});

test("group by type with unset bucket at end", () => {
  const result = applyGroupSort(sample, {
    groupBy: "type",
    sortBy: "default",
    sortDir: "desc",
  });
  assert.equal(result.mode, "grouped");
  assert.deepEqual(
    result.groups.map((g) => g.label),
    ["jacket", "shirt", "shoes", "No type"]
  );
  assert.deepEqual(
    result.groups.find((g) => g.label === "jacket").items.map((i) => i.itemId),
    ["b", "c"]
  );
});

test("group by formality keeps distinct wardrobe strings; ordered by rank", () => {
  const result = applyGroupSort(sample, {
    groupBy: "formality",
    sortBy: "default",
    sortDir: "desc",
  });
  assert.deepEqual(
    result.groups.map((g) => g.label),
    ["black-tie", "business", "casual", "weekend", "No formality"]
  );
});

test("group by dateAdded buckets Europe/Berlin calendar days", () => {
  const key = berlinDayKey("2026-11-12T10:00:00.000Z");
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  const label = formatBerlinDayLabel("2026-11-12T10:00:00.000Z");
  assert.match(label, /Nov 2026/);

  const result = applyGroupSort(sample, {
    groupBy: "dateAdded",
    sortBy: "default",
    sortDir: "desc",
  });
  assert.equal(result.mode, "grouped");
  const labels = result.groups.map((g) => g.label);
  assert.equal(labels[labels.length - 1], "Unknown date");
  assert.ok(labels.includes(formatBerlinDayLabel("2026-11-12T10:00:00.000Z")));
});

test("group + sort: sort applies within groups", () => {
  const result = applyGroupSort(sample, {
    groupBy: "type",
    sortBy: "brandModel",
    sortDir: "asc",
  });
  const jackets = result.groups.find((g) => g.label === "jacket");
  assert.deepEqual(
    jackets.items.map((i) => i.brandModel),
    ["Hiltl 2", "Hiltl 10"]
  );
});

test("localStorage round-trip for arrange prefs", () => {
  const store = {
    data: Object.create(null),
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.data, key)
        ? this.data[key]
        : null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
  };
  const saved = writeArrangePrefs(
    { groupBy: "type", sortBy: "dateAdded", sortDir: "asc" },
    store
  );
  assert.deepEqual(saved, {
    groupBy: "type",
    sortBy: "dateAdded",
    sortDir: "asc",
  });
  assert.deepEqual(readArrangePrefs(store), saved);
  assert.equal(arrangeActive(saved), true);
});

test("arrangeToggleLabel reflects open and active state", () => {
  assert.equal(arrangeToggleLabel(defaultArrangePrefs(), true), "Hide arrange");
  assert.equal(arrangeToggleLabel(defaultArrangePrefs(), false), "Arrange");
  assert.equal(
    arrangeToggleLabel({ groupBy: "type", sortBy: "default", sortDir: "desc" }, false),
    "Arrange · grouped"
  );
  assert.equal(
    arrangeToggleLabel({ groupBy: "none", sortBy: "type", sortDir: "asc" }, false),
    "Arrange · sorted"
  );
  assert.equal(
    arrangeToggleLabel({ groupBy: "type", sortBy: "type", sortDir: "asc" }, false),
    "Arrange · grouped + sorted"
  );
});
