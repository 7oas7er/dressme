"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var cutouts = require("./cutouts");

test("cutoutKeyFor replaces extension with .cutout.webp", function () {
  assert.equal(
    cutouts.cutoutKeyFor("users/u1/items/i1/p1.jpg"),
    "users/u1/items/i1/p1.cutout.webp"
  );
  assert.equal(
    cutouts.cutoutKeyFor("users/u1/items/i1/p1.webp"),
    "users/u1/items/i1/p1.cutout.webp"
  );
});

test("CUTOUT_VERSION is 3 for wardrobe-photo matte bump", function () {
  assert.equal(typeof cutouts.CUTOUT_VERSION, "number");
  assert.equal(cutouts.CUTOUT_VERSION, 3);
});

test("matteRgba clears uniform border background, keeps center subject", function () {
  var width = 8;
  var height = 8;
  var data = Buffer.alloc(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      var nearEdge =
        x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2;
      if (nearEdge) {
        data[i] = 240;
        data[i + 1] = 240;
        data[i + 2] = 240;
        data[i + 3] = 255;
      } else {
        // Dark subject in the center.
        data[i] = 20;
        data[i + 1] = 40;
        data[i + 2] = 80;
        data[i + 3] = 255;
      }
    }
  }

  var out = cutouts.matteRgba(data, width, height);
  // Corner should be transparent (bg).
  assert.equal(out[3], 0);
  // Center subject should stay opaque.
  var center = ((height / 2) * width + width / 2) * 4 + 3;
  assert.equal(out[center], 255);
});

test("matteRgba keeps a pale subject that touches mid-edge (hysteresis)", function () {
  var width = 16;
  var height = 16;
  var data = Buffer.alloc(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      // Light grey paper background.
      data[i] = 245;
      data[i + 1] = 245;
      data[i + 2] = 245;
      data[i + 3] = 255;
    }
  }
  // Pale shirt column that touches the bottom edge (common flat-lay framing).
  for (var sy = 4; sy < height; sy++) {
    for (var sx = 5; sx <= 10; sx++) {
      var si = (sy * width + sx) * 4;
      data[si] = 230;
      data[si + 1] = 228;
      data[si + 2] = 220;
      data[si + 3] = 255;
    }
  }

  var out = cutouts.matteRgba(data, width, height);
  assert.equal(out[3], 0, "corner bg cleared");
  // Interior of the pale column should remain mostly opaque (not eaten).
  var mid = (8 * width + 7) * 4 + 3;
  assert.ok(out[mid] > 200, "pale garment interior kept, alpha=" + out[mid]);
});

test("matteRgba clears wrinkled-sheet shadows connected to the border", function () {
  var width = 24;
  var height = 24;
  var data = Buffer.alloc(width * height * 4);
  var x;
  var y;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      // Base sheet white.
      var v = 248;
      // Soft fold shadows (darker, same chroma) across the frame — v2 flood stopped here.
      if ((x + y) % 7 === 0 || (x * 2 + y) % 11 === 0) v = 190;
      if ((x + y * 2) % 13 === 0) v = 165;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  // Dark jacket block in the center (not touching border).
  for (y = 7; y <= 16; y++) {
    for (x = 7; x <= 16; x++) {
      var ji = (y * width + x) * 4;
      data[ji] = 18;
      data[ji + 1] = 18;
      data[ji + 2] = 22;
      data[ji + 3] = 255;
    }
  }

  var out = cutouts.matteRgba(data, width, height);
  assert.equal(out[3], 0, "corner cleared");
  // A mid-border shadow pixel that was not a corner should clear (shadow mode).
  var shadowPx = (2 * width + 11) * 4 + 3;
  assert.ok(out[shadowPx] < 40, "sheet shadow cleared, alpha=" + out[shadowPx]);
  var center = (12 * width + 12) * 4 + 3;
  assert.equal(out[center], 255, "jacket kept");
});

test("matteRgba drops a leftover opaque plate disconnected from the subject", function () {
  var width = 20;
  var height = 20;
  var data = Buffer.alloc(width * height * 4);
  var x;
  var y;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      data[i] = 250;
      data[i + 1] = 250;
      data[i + 2] = 250;
      data[i + 3] = 255;
    }
  }
  // Subject blob (center) — largest opaque component.
  for (y = 6; y <= 13; y++) {
    for (x = 6; x <= 13; x++) {
      var si = (y * width + x) * 4;
      data[si] = 30;
      data[si + 1] = 40;
      data[si + 2] = 90;
    }
  }
  // Smaller dark island that does not match white bg (flood leaves it opaque);
  // largest-component keep should drop it.
  for (y = 2; y <= 4; y++) {
    for (x = 15; x <= 17; x++) {
      var pi = (y * width + x) * 4;
      data[pi] = 40;
      data[pi + 1] = 20;
      data[pi + 2] = 20;
    }
  }

  var out = cutouts.matteRgba(data, width, height);
  var plate = (3 * width + 16) * 4 + 3;
  var subject = (10 * width + 10) * 4 + 3;
  assert.ok(out[subject] > 200, "subject kept");
  assert.ok(
    out[plate] < 40,
    "disconnected plate cleared by largest-component keep, alpha=" + out[plate]
  );
});

test("isShadowOfBg accepts darker same-chroma sheet folds", function () {
  var proto = { r: 245, g: 245, b: 245 };
  assert.equal(cutouts.isShadowOfBg(180, 180, 180, proto), true);
  assert.equal(cutouts.isShadowOfBg(20, 20, 80, proto), false);
  assert.equal(cutouts.isShadowOfBg(245, 245, 245, proto), false);
  // Pale shirt ΔL vs white paper must not count as a sheet shadow.
  assert.equal(cutouts.isShadowOfBg(230, 228, 220, proto), false);
});

test("contentBBox finds opaque subject with padding", function () {
  var width = 20;
  var height = 20;
  var data = Buffer.alloc(width * height * 4);
  for (var y = 6; y <= 12; y++) {
    for (var x = 6; x <= 12; x++) {
      var i = (y * width + x) * 4;
      data[i] = 10;
      data[i + 1] = 10;
      data[i + 2] = 10;
      data[i + 3] = 255;
    }
  }
  var box = cutouts.contentBBox(data, width, height, 12);
  assert.ok(box);
  assert.ok(box.left <= 6);
  assert.ok(box.top <= 6);
  assert.ok(box.left + box.width > 12);
  assert.ok(box.top + box.height > 12);
});
