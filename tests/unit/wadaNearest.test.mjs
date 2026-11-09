import assert from "node:assert/strict";
import test from "node:test";
import {
  deltaE76,
  hexToLab,
  nearestWadaColor,
  nearestWadaColors,
  parseHexRgb,
} from "../../web/src/wadaNearest.js";
import { WADA_COLORS } from "../../web/src/wadaPalette.js";

test("parseHexRgb accepts #rrggbb and #rgb", () => {
  assert.deepEqual(parseHexRgb("#f9c1ce"), { r: 249, g: 193, b: 206 });
  assert.deepEqual(parseHexRgb("0af"), { r: 0, g: 170, b: 255 });
  assert.equal(parseHexRgb("nope"), null);
});

test("exact palette hex returns itself as top match", () => {
  for (const color of WADA_COLORS.slice(0, 12)) {
    const hit = nearestWadaColor(color.hex);
    assert.ok(hit, color.id);
    assert.equal(hit.id, color.id);
    assert.ok(hit.deltaE < 1e-6);
  }
});

test("navy-ish sample ranks a dark blue ahead of pinks", () => {
  const hits = nearestWadaColors("#1a2f5b", { limit: 5 });
  assert.equal(hits.length, 5);
  assert.ok(hits[0].deltaE <= hits[1].deltaE);
  assert.equal(hits[0].id, "wada:v1:127"); // Violet Blue
  assert.ok(
    hits.some((h) => h.id === "wada:v1:126" || h.id === "wada:v1:129"),
    "nearby dark blues stay in the top ranks"
  );
  // Hermosa Pink must not win a navy sample.
  assert.notEqual(hits[0].id, "wada:v1:0");
});

test("CIE76 is zero for identical Lab; hexToLab is deterministic", () => {
  const lab = hexToLab("#f9c1ce");
  assert.ok(lab);
  assert.equal(deltaE76(lab, lab), 0);
  assert.deepEqual(hexToLab("#F9C1CE"), lab);
});
