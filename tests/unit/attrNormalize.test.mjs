import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeAttrValue,
  foldForMatch,
  levenshtein,
  matchAttrOption,
  normalizeAttrValue,
} from "../../web/src/attrNormalize.js";

test("normalizeAttrValue trims, collapses spaces, clamps", () => {
  assert.equal(normalizeAttrValue("  mid  blue  "), "mid blue");
  assert.equal(normalizeAttrValue(null), "");
  assert.equal(normalizeAttrValue("   "), "");
  assert.equal(normalizeAttrValue("x".repeat(200)).length, 120);
});

test("normalizeAttrValue unifies delimiters and strips trailing punct", () => {
  assert.equal(normalizeAttrValue("white/blue"), "white, blue");
  assert.equal(normalizeAttrValue("white|blue"), "white, blue");
  assert.equal(normalizeAttrValue("white;blue"), "white, blue");
  assert.equal(normalizeAttrValue("white&blue"), "white, blue");
  assert.equal(normalizeAttrValue("navy."), "navy");
  assert.equal(normalizeAttrValue("navy,"), "navy");
});

test("foldForMatch drops case and periods", () => {
  assert.equal(foldForMatch("U.S.A."), "usa");
  assert.equal(foldForMatch("USA"), "usa");
  assert.equal(foldForMatch("Navy"), "navy");
});

test("levenshtein distance", () => {
  assert.equal(levenshtein("navy", "navy"), 0);
  assert.equal(levenshtein("lauren", "laurn"), 1);
  assert.equal(levenshtein("ralph lauren", "ralph laurn"), 1);
  assert.equal(levenshtein("navy", "black"), 2);
});

test("silent casing rewrite on fold-match", () => {
  const options = ["navy", "mid blue"];
  const result = matchAttrOption("Navy", options, []);
  assert.equal(result.action, "silent");
  assert.equal(result.suggestion, "navy");
  assert.equal(canonicalizeAttrValue("Navy", options, []), "navy");
});

test("delimiter near-match shows chip; canonicalize still folds to option", () => {
  const options = ["white, blue", "navy"];
  const result = matchAttrOption("White/Blue", options, []);
  assert.equal(result.action, "chip");
  assert.equal(result.suggestion, "white, blue");
  assert.equal(result.normalized, "White, Blue");
  assert.equal(canonicalizeAttrValue("White/Blue", options, []), "white, blue");
});

test("Levenshtein-1 brand typo chips; canonicalize does not auto-apply", () => {
  const options = ["Ralph Lauren", "Drake's"];
  const customs = ["Ralph Lauren", "Drake's"];
  const result = matchAttrOption("Ralph Laurn", options, customs);
  assert.equal(result.action, "chip");
  assert.equal(result.suggestion, "Ralph Lauren");
  assert.equal(result.normalized, "Ralph Laurn");
  assert.equal(canonicalizeAttrValue("Ralph Laurn", options, customs), "Ralph Laurn");
});

test("prefer seed over custom when both fold-match", () => {
  const options = ["Navy", "navy"];
  const result = matchAttrOption("NAVY", options, ["Navy"]);
  assert.equal(result.action, "silent");
  assert.equal(result.suggestion, "navy");
});

test("no match keeps normalized free text", () => {
  const options = ["navy", "wool"];
  const result = matchAttrOption("periwinkle", options, []);
  assert.equal(result.action, "none");
  assert.equal(result.normalized, "periwinkle");
  assert.equal(canonicalizeAttrValue("periwinkle", options, []), "periwinkle");
});

test("U.S.A. fold-matches USA option", () => {
  const options = ["USA"];
  const result = matchAttrOption("U.S.A.", options, ["USA"]);
  assert.ok(result.action === "silent" || result.action === "chip");
  assert.equal(result.suggestion, "USA");
  assert.equal(canonicalizeAttrValue("U.S.A.", options, ["USA"]), "USA");
});
