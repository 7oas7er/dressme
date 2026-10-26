"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

var auth = require("./auth");

test("extractIdToken prefers x-id-token over Authorization", function () {
  var token = auth.extractIdToken({
    headers: {
      authorization: "Bearer from-auth",
      "x-id-token": "from-custom",
    },
  });
  assert.equal(token, "from-custom");
});

test("extractIdToken accepts raw JWT on x-id-token", function () {
  var token = auth.extractIdToken({
    headers: { "X-Id-Token": "abc.def.ghi" },
  });
  assert.equal(token, "abc.def.ghi");
});

test("extractIdToken strips Bearer on x-id-token", function () {
  var token = auth.extractIdToken({
    headers: { "x-id-token": "Bearer abc.def.ghi" },
  });
  assert.equal(token, "abc.def.ghi");
});

test("extractIdToken falls back to Authorization Bearer", function () {
  var token = auth.extractIdToken({
    headers: { Authorization: "Bearer abc.def.ghi" },
  });
  assert.equal(token, "abc.def.ghi");
});

test("extractIdToken rejects non-Bearer Authorization", function () {
  var token = auth.extractIdToken({
    headers: { authorization: "Basic abc" },
  });
  assert.equal(token, "");
});

test("extractIdToken returns empty when missing", function () {
  assert.equal(auth.extractIdToken({ headers: {} }), "");
});
