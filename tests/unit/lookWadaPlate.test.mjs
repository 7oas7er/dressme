import assert from "node:assert/strict";
import test from "node:test";
import {
  lookWadaPlateEntries,
  primaryWadaPlateEntry,
} from "../../web/src/lookWadaPlate.js";

test("lookWadaPlateEntries keeps photo order, no dedupe, skips missing Wada", () => {
  const entries = lookWadaPlateEntries([
    { itemId: "a", wadaColorIds: ["wada:v1:42"] },
    { itemId: "b", wadaColorIds: [] },
    { itemId: "c" },
    { itemId: "d", wadaColorIds: ["wada:v1:42"] },
    { itemId: "e", wadaColorIds: ["wada:v1:7"] },
    { itemId: "f", wadaColorIds: ["wada:v1:999"] },
  ]);
  // Same primary twice → two swatches (one above each piece); unresolved skipped.
  assert.equal(entries.length, 3);
  assert.equal(entries[0].id, "wada:v1:42");
  assert.equal(entries[0].itemId, "a");
  assert.ok(entries[0].name);
  assert.ok(entries[0].hex.startsWith("#"));
  assert.equal(entries[1].id, "wada:v1:42");
  assert.equal(entries[1].itemId, "d");
  assert.equal(entries[2].id, "wada:v1:7");
  assert.equal(entries[2].itemId, "e");
});

test("primaryWadaPlateEntry returns null without resolvable primary", () => {
  assert.equal(primaryWadaPlateEntry(null), null);
  assert.equal(primaryWadaPlateEntry({ type: "blazer" }), null);
  assert.equal(primaryWadaPlateEntry({ wadaColorIds: ["wada:v1:999"] }), null);
});

test("lookWadaPlateEntries returns empty when no resolvable primaries", () => {
  assert.deepEqual(lookWadaPlateEntries([]), []);
  assert.deepEqual(lookWadaPlateEntries([{ type: "blazer" }]), []);
});
