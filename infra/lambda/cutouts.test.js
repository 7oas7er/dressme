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

test("matteRgba clears uniform border background, keeps center subject", function () {
  var width = 8;
  var height = 8;
  var data = Buffer.alloc(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      var edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
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
      void edge;
    }
  }

  var out = cutouts.matteRgba(data, width, height);
  // Corner should be transparent (bg).
  assert.equal(out[3], 0);
  // Center subject should stay opaque.
  var center = ((height / 2) * width + width / 2) * 4 + 3;
  assert.equal(out[center], 255);
});
