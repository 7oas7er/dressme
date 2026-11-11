import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WADA_COLORS,
  WADA_COLORS,
  getWadaColor,
  normalizeWadaColorIdsClient,
  primaryWadaHex,
  searchWadaColors,
} from "../../web/src/wadaPalette.js";

test("vendored palette has 159 stable wada:v1 ids", () => {
  assert.equal(WADA_COLORS.length, 159);
  assert.equal(WADA_COLORS[0].id, "wada:v1:0");
  assert.equal(WADA_COLORS[0].name, "Hermosa Pink");
  assert.equal(WADA_COLORS[0].hex, "#f9c1ce");
  assert.equal(WADA_COLORS[158].id, "wada:v1:158");
  assert.equal(MAX_WADA_COLORS, 4);
});

test("normalize dedupes, drops unknown, clamps to max", () => {
  assert.deepEqual(
    normalizeWadaColorIdsClient([
      "wada:v1:1",
      "wada:v1:1",
      "nope",
      "wada:v1:2",
      "wada:v1:3",
      "wada:v1:4",
      "wada:v1:5",
    ]),
    ["wada:v1:1", "wada:v1:2", "wada:v1:3", "wada:v1:4"]
  );
});

test("search filters by English name; primary hex resolves", () => {
  const hits = searchWadaColors("hermosa");
  assert.ok(hits.some((c) => c.id === "wada:v1:0"));
  assert.equal(primaryWadaHex(["wada:v1:0", "wada:v1:1"]), "#f9c1ce");
  assert.equal(getWadaColor("wada:v1:999"), null);
});
