"use strict";

var auth = require("./auth");
var analyze = require("./analyze");
var attributeOptions = require("./attributeOptions");
var health = require("./health");
var http = require("./http");
var items = require("./items");
var suggest = require("./suggest");

/**
 * DressMe API router (Function URL behind CloudFront /api/*).
 */
exports.handler = async function handler(event) {
  var method = http.getMethod(event);
  var path = http.getPath(event);

  if (method === "OPTIONS") {
    return http.json(204, {});
  }

  try {
    if (path === "/api/health" || path === "/health") {
      var healthResult = health.handleHealth(method);
      return http.json(healthResult.statusCode, healthResult.body);
    }

    if (path === "/api/config" || path === "/config") {
      if (method !== "GET" && method !== "HEAD") {
        return http.json(405, { error: "method_not_allowed" });
      }
      return http.json(200, { cognito: auth.publicConfig() });
    }

    if (
      path === "/api/attribute-options" ||
      path === "/attribute-options"
    ) {
      var optionsUser = await auth.requireUser(event);
      if (method === "GET" || method === "HEAD") {
        return respond(await attributeOptions.listAttributeOptions(optionsUser));
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    if (
      path === "/api/photos/backfill-thumbs" ||
      path === "/photos/backfill-thumbs"
    ) {
      var backfillUser = await auth.requireUser(event);
      if (method === "POST") {
        return respond(await items.backfillThumbs(backfillUser));
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    if (
      path === "/api/photos/backfill-cutouts" ||
      path === "/photos/backfill-cutouts"
    ) {
      var cutoutBackfillUser = await auth.requireUser(event);
      if (method === "POST") {
        return respond(
          await items.backfillCutouts(
            cutoutBackfillUser,
            http.parseBody(event)
          )
        );
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    if (path === "/api/suggest" || path === "/suggest") {
      var suggestUser = await auth.requireUser(event);
      if (method === "POST") {
        return respond(await suggest.suggestLooks(suggestUser, http.parseBody(event)));
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    if (path === "/api/items/analyze" || path === "/items/analyze") {
      var analyzeUser = await auth.requireUser(event);
      if (method === "POST") {
        return respond(await analyze.analyzeItem(analyzeUser, http.parseBody(event)));
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    var itemMatch = /^\/api\/items(?:\/([^/]+))?(?:\/(photos\/complete))?$/.exec(path);
    if (!itemMatch && /^\/items(?:\/([^/]+))?(?:\/(photos\/complete))?$/.exec(path)) {
      itemMatch = /^\/items(?:\/([^/]+))?(?:\/(photos\/complete))?$/.exec(path);
    }

    if (itemMatch) {
      var user = await auth.requireUser(event);
      var itemId = itemMatch[1];
      var action = itemMatch[2];

      if (!itemId && method === "GET") {
        return respond(await items.listItems(user, http.getQuery(event)));
      }
      if (!itemId && method === "POST") {
        return respond(await items.createItem(user, http.parseBody(event)));
      }
      if (itemId && action === "photos/complete" && method === "POST") {
        return respond(await items.confirmPhotos(user, itemId, http.parseBody(event)));
      }
      if (itemId && !action && method === "GET") {
        return respond(await items.getItem(user, itemId));
      }
      if (itemId && !action && (method === "PUT" || method === "PATCH")) {
        return respond(await items.updateItem(user, itemId, http.parseBody(event)));
      }
      if (itemId && !action && method === "DELETE") {
        return respond(await items.deleteItem(user, itemId));
      }
      return http.json(405, { error: "method_not_allowed" });
    }

    return http.json(404, { error: "not_found" });
  } catch (err) {
    var status = (err && err.statusCode) || 500;
    var code = (err && err.message) || "internal_error";
    // Scrub unexpected 5xx messages; keep intentional Bedrock / suggest codes.
    var keepCodes = {
      analyze_unavailable: true,
      bedrock_analyze_failed: true,
      analyze_empty_model_response: true,
      analyze_invalid_model_json: true,
      suggest_unavailable: true,
      suggest_invalid_model_json: true,
      suggest_invalid_item_ids: true,
      suggest_empty_model_response: true,
      suggest_engine_unavailable: true,
    };
    if (status >= 500 && !keepCodes[code]) {
      console.error("api_error", code, err && err.stack ? err.stack : err);
      code = "internal_error";
    } else if (status >= 500) {
      console.error("api_upstream", code);
    }
    return http.json(status, { error: code });
  }
};

function respond(result) {
  return http.json(result.statusCode, result.body || {});
}
