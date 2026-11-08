"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var thumbs = require("./thumbs");

test("thumbKeyFor replaces extension with .thumb.jpg", function () {
  assert.equal(
    thumbs.thumbKeyFor("users/u1/items/i1/p1.jpg"),
    "users/u1/items/i1/p1.thumb.jpg"
  );
  assert.equal(
    thumbs.thumbKeyFor("users/u1/items/i1/p1.webp"),
    "users/u1/items/i1/p1.thumb.jpg"
  );
});

test("streamToBuffer accepts Buffer and transformToByteArray bodies", async function () {
  var fromBuf = await thumbs.streamToBuffer(Buffer.from("abc"));
  assert.equal(fromBuf.toString(), "abc");

  var fromSdk = await thumbs.streamToBuffer({
    transformToByteArray: async function () {
      return new Uint8Array([65, 66]);
    },
  });
  assert.equal(fromSdk.toString(), "AB");
});

test("thumbs module no longer exports server rotate helper", function () {
  assert.equal(thumbs.rotateOriginalWithSharp, undefined);
  assert.equal(typeof thumbs.makeThumbWithSharp, "function");
});
