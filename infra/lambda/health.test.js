"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";

var api = require("./api");

test("GET /api/health returns ok payload", async function () {
  var res = await api.handler({
    rawPath: "/api/health",
    requestContext: { http: { method: "GET", path: "/api/health" } },
  });
  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, "dressme");
});

test("POST /api/health is rejected", async function () {
  var res = await api.handler({
    rawPath: "/api/health",
    requestContext: { http: { method: "POST", path: "/api/health" } },
  });
  assert.equal(res.statusCode, 405);
});

test("GET /api/config returns cognito public fields", async function () {
  process.env.COGNITO_USER_POOL_ID = "eu-north-1_example";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COGNITO_AUTH_DOMAIN = "https://example.auth.eu-north-1.amazoncognito.com";
  process.env.COGNITO_REDIRECT_URI = "https://dressme-stg.7oas7er.com/";
  var res = await api.handler({
    rawPath: "/api/config",
    requestContext: { http: { method: "GET", path: "/api/config" } },
  });
  assert.equal(res.statusCode, 200);
  var body = JSON.parse(res.body);
  assert.equal(body.cognito.clientId, "client123");
  assert.equal(body.cognito.userPoolId, "eu-north-1_example");
});
