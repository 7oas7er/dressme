"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var attrNormalize = require("./attrNormalize");

test("normalizeAttrValue trims, collapses spaces, clamps", function () {
  assert.equal(attrNormalize.normalizeAttrValue("  mid  blue  "), "mid blue");
  assert.equal(attrNormalize.normalizeAttrValue(null), "");
  assert.equal(attrNormalize.normalizeAttrValue("   "), "");
  var long = "x".repeat(200);
  assert.equal(attrNormalize.normalizeAttrValue(long).length, 120);
});

test("normalizeAttrValue unifies delimiters and strips trailing punct", function () {
  assert.equal(attrNormalize.normalizeAttrValue("white/blue"), "white, blue");
  assert.equal(attrNormalize.normalizeAttrValue("white|blue"), "white, blue");
  assert.equal(attrNormalize.normalizeAttrValue("white;blue"), "white, blue");
  assert.equal(attrNormalize.normalizeAttrValue("white&blue"), "white, blue");
  assert.equal(attrNormalize.normalizeAttrValue("navy."), "navy");
  assert.equal(attrNormalize.normalizeAttrValue("navy,"), "navy");
});

test("foldForMatch drops case and periods", function () {
  assert.equal(attrNormalize.foldForMatch("U.S.A."), "usa");
  assert.equal(attrNormalize.foldForMatch("USA"), "usa");
  assert.equal(attrNormalize.foldForMatch("Navy"), "navy");
});

test("levenshtein distance", function () {
  assert.equal(attrNormalize.levenshtein("navy", "navy"), 0);
  assert.equal(attrNormalize.levenshtein("lauren", "laurn"), 1);
  assert.equal(attrNormalize.levenshtein("ralph lauren", "ralph laurn"), 1);
  assert.equal(attrNormalize.levenshtein("navy", "black"), 2);
});

test("silent casing rewrite on fold-match", function () {
  var options = ["navy", "mid blue"];
  var result = attrNormalize.matchAttrOption("Navy", options, []);
  assert.equal(result.action, "silent");
  assert.equal(result.suggestion, "navy");
  assert.equal(attrNormalize.canonicalizeAttrValue("Navy", options, []), "navy");
});

test("delimiter near-match shows chip; canonicalize still folds to option", function () {
  var options = ["white, blue", "navy"];
  var result = attrNormalize.matchAttrOption("White/Blue", options, []);
  assert.equal(result.action, "chip");
  assert.equal(result.suggestion, "white, blue");
  assert.equal(result.normalized, "White, Blue");
  assert.equal(
    attrNormalize.canonicalizeAttrValue("White/Blue", options, []),
    "white, blue"
  );
});

test("Levenshtein-1 brand typo chips; canonicalize does not auto-apply", function () {
  var options = ["Ralph Lauren", "Drake's"];
  var result = attrNormalize.matchAttrOption("Ralph Laurn", options, [
    "Ralph Lauren",
    "Drake's",
  ]);
  assert.equal(result.action, "chip");
  assert.equal(result.suggestion, "Ralph Lauren");
  assert.equal(result.normalized, "Ralph Laurn");
  assert.equal(
    attrNormalize.canonicalizeAttrValue("Ralph Laurn", options, [
      "Ralph Lauren",
      "Drake's",
    ]),
    "Ralph Laurn"
  );
});

test("prefer seed over custom when both fold-match", function () {
  var options = ["Navy", "navy"];
  var result = attrNormalize.matchAttrOption("NAVY", options, ["Navy"]);
  assert.equal(result.action, "silent");
  assert.equal(result.suggestion, "navy");
});

test("no match keeps normalized free text", function () {
  var options = ["navy", "wool"];
  var result = attrNormalize.matchAttrOption("periwinkle", options, []);
  assert.equal(result.action, "none");
  assert.equal(result.normalized, "periwinkle");
  assert.equal(
    attrNormalize.canonicalizeAttrValue("periwinkle", options, []),
    "periwinkle"
  );
});

test("U.S.A. fold-matches USA option", function () {
  var options = ["USA"];
  var result = attrNormalize.matchAttrOption("U.S.A.", options, ["USA"]);
  assert.ok(result.action === "silent" || result.action === "chip");
  assert.equal(result.suggestion, "USA");
  assert.equal(attrNormalize.canonicalizeAttrValue("U.S.A.", options, ["USA"]), "USA");
});
