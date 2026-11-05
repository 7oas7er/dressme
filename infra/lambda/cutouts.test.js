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

test("CUTOUT_VERSION is a positive integer for backfill upgrades", function () {
  assert.equal(typeof cutouts.CUTOUT_VERSION, "number");
  assert.ok(cutouts.CUTOUT_VERSION >= 2);
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
