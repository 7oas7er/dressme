"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var health = require("./health.js");

test("GET returns ok payload", async function () {
  var res = await health.handler({
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, "dressme");
});

test("POST is rejected", async function () {
  var res = await health.handler({
    requestContext: { http: { method: "POST" } },
  });
  assert.equal(res.statusCode, 405);
});
