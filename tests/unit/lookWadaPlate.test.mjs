import assert from "node:assert/strict";
import test from "node:test";
import { lookWadaPlateEntries } from "../../web/src/lookWadaPlate.js";

test("lookWadaPlateEntries skips missing Wada, dedupes primaries, no free-text fallback", () => {
  const entries = lookWadaPlateEntries([
    { itemId: "a", wadaColorIds: ["wada:v1:42"] },
    { itemId: "b", wadaColorIds: [] },
    { itemId: "c", color: "navy" },
    { itemId: "d", wadaColorIds: ["wada:v1:42"] },
    { itemId: "e", wadaColorIds: ["wada:v1:7"] },
    { itemId: "f", wadaColorIds: ["wada:v1:999"] },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "wada:v1:42");
  assert.ok(entries[0].name);
  assert.ok(entries[0].hex.startsWith("#"));
  assert.equal(entries[1].id, "wada:v1:7");
});

test("lookWadaPlateEntries returns empty when no resolvable primaries", () => {
  assert.deepEqual(lookWadaPlateEntries([]), []);
  assert.deepEqual(lookWadaPlateEntries([{ color: "navy" }]), []);
});
