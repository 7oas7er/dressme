"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

process.env.AUTH_DISABLED = "true";
process.env.ITEMS_TABLE = "test-items";
process.env.MEDIA_BUCKET = "test-media";
delete process.env.CORS_ALLOWED_ORIGINS;

var http = require("./http");
var api = require("./api");

test("corsHeaders reflects allowed site origin", function () {
  var headers = http.corsHeaders({
    headers: { origin: "https://dressme-stg.7oas7er.com" },
  });
  assert.equal(
    headers["access-control-allow-origin"],
    "https://dressme-stg.7oas7er.com"
  );
  assert.equal(headers.vary, "Origin");
});

test("corsHeaders omits ACAO for unknown origin", function () {
  var headers = http.corsHeaders({
    headers: { origin: "https://evil.example" },
  });
  assert.equal(headers["access-control-allow-origin"], undefined);
});

test("corsHeaders honors CORS_ALLOWED_ORIGINS override", function () {
  process.env.CORS_ALLOWED_ORIGINS = "https://custom.example,http://localhost:5173";
  try {
    var ok = http.corsHeaders({
      headers: { origin: "https://custom.example" },
    });
    assert.equal(ok["access-control-allow-origin"], "https://custom.example");
    var denied = http.corsHeaders({
      headers: { origin: "https://dressme.7oas7er.com" },
    });
    assert.equal(denied["access-control-allow-origin"], undefined);
  } finally {
    delete process.env.CORS_ALLOWED_ORIGINS;
  }
});

test("OPTIONS and JSON responses never use wildcard CORS", async function () {
  var preflight = await api.handler({
    rawPath: "/api/health",
    requestContext: { http: { method: "OPTIONS", path: "/api/health" } },
    headers: { origin: "https://dressme.7oas7er.com" },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    "https://dressme.7oas7er.com"
  );
  assert.notEqual(preflight.headers["access-control-allow-origin"], "*");

  var health = await api.handler({
    rawPath: "/api/health",
    requestContext: { http: { method: "GET", path: "/api/health" } },
    headers: { Origin: "https://dressme-stg.7oas7er.com" },
  });
  assert.equal(health.statusCode, 200);
  assert.equal(
    health.headers["access-control-allow-origin"],
    "https://dressme-stg.7oas7er.com"
  );
  assert.notEqual(health.headers["access-control-allow-origin"], "*");
});
