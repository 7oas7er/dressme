"use strict";

/**
 * Site origins allowed for browser CORS (match media bucket CORS + both envs).
 * Override with comma-separated CORS_ALLOWED_ORIGINS when needed.
 */
var DEFAULT_ALLOWED_ORIGINS = [
  "https://dressme.7oas7er.com",
  "https://dressme-stg.7oas7er.com",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

function allowedOrigins() {
  var raw = process.env.CORS_ALLOWED_ORIGINS;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS.slice();
}

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  return allowedOrigins().indexOf(origin) !== -1;
}

function corsHeaders(event) {
  var headers = {
    "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-id-token,x-amz-content-sha256",
    "cache-control": "no-store",
    vary: "Origin",
  };
  var origin = getHeader(event, "origin");
  if (isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function json(statusCode, body, event) {
  return {
    statusCode: statusCode,
    headers: Object.assign(
      {
        "content-type": "application/json; charset=utf-8",
      },
      corsHeaders(event)
    ),
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

function getMethod(event) {
  return (
    (event &&
      event.requestContext &&
      event.requestContext.http &&
      event.requestContext.http.method) ||
    (event && event.httpMethod) ||
    "GET"
  );
}

function getPath(event) {
  var raw =
    (event && event.rawPath) ||
    (event && event.requestContext && event.requestContext.http && event.requestContext.http.path) ||
    (event && event.path) ||
    "/";
  // CloudFront may forward the full viewer path.
  if (typeof raw === "string" && raw.length > 1 && raw.endsWith("/")) {
    return raw.slice(0, -1);
  }
  return raw || "/";
}

function getHeader(event, name) {
  var headers = (event && event.headers) || {};
  var lower = name.toLowerCase();
  for (var key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function parseBody(event) {
  if (!event || event.body == null || event.body === "") {
    return {};
  }
  var raw = event.body;
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  try {
    return JSON.parse(raw);
  } catch (_err) {
    var error = new Error("invalid_json");
    error.statusCode = 400;
    throw error;
  }
}

function getQuery(event) {
  return (event && event.queryStringParameters) || {};
}

exports.DEFAULT_ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS;
exports.allowedOrigins = allowedOrigins;
exports.isAllowedOrigin = isAllowedOrigin;
exports.corsHeaders = corsHeaders;
exports.json = json;
exports.getMethod = getMethod;
exports.getPath = getPath;
exports.getHeader = getHeader;
exports.parseBody = parseBody;
exports.getQuery = getQuery;
