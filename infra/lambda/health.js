"use strict";

/**
 * Scaffold health endpoint for DressMe.
 * Replaces Block Drop high-scores until Cognito + catalog/suggest Lambdas land.
 */
exports.handler = async function handler(event) {
  var method =
    (event && (event.requestContext && event.requestContext.http && event.requestContext.http.method)) ||
    (event && event.httpMethod) ||
    "GET";

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "method_not_allowed" });
  }

  return json(200, {
    ok: true,
    service: "dressme",
    path: "/api/health",
  });
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
}

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: Object.assign(
      {
        "content-type": "application/json; charset=utf-8",
      },
      corsHeaders()
    ),
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}
