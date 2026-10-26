"use strict";

/**
 * Scaffold health endpoint for DressMe.
 */
function handleHealth(method) {
  if (method !== "GET" && method !== "HEAD") {
    return { statusCode: 405, body: { error: "method_not_allowed" } };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      service: "dressme",
      path: "/api/health",
    },
  };
}

exports.handleHealth = handleHealth;
