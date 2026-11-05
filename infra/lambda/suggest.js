"use strict";

/**
 * Outfit suggestions (UC-04–06).
 *
 * v1 MVP: random role-slot assembly from the caller's catalog only.
 * Extension point: set SUGGEST_ENGINE=bedrock (or body.engine) later to swap
 * random → Bedrock (attrs + item IDs only; photos never sent to the model).
 */

var crypto = require("crypto");
var items = require("./items");

var LOOK_COUNT = 3;
var MAX_TEXT = 240;

/**
 * Ordered slots for a classic menswear flat-lay. Empty slots are skipped.
 * `roles` match outfitRole first (preferred); `types` match type as fallback.
 * Keep footwear type tokens away from shirt-like words (e.g. "oxford" shirt).
 */
var SLOT_DEFS = [
  {
    id: "footwear",
    label: "footwear",
    roles: ["footwear", "shoes", "shoe"],
    types: [/shoe/, /boot/, /loafer/, /sneaker/, /derby/, /monk\s*strap/],
  },
  {
    id: "trousers",
    label: "trousers",
    roles: ["trousers", "pants", "bottoms"],
    types: [/trousers/, /pants/, /jean/, /chino/, /short/, /trouser/],
  },
  {
    id: "base",
    label: "base / shirt",
    roles: ["base", "shirt", "knitwear", "top"],
    types: [/\bshirt\b/, /knit/, /sweater/, /polo/, /\btee\b/, /t-shirt/, /blouse/, /oxford/],
  },
  {
    id: "outer",
    label: "jacket / outerwear",
    roles: ["outerwear", "jacket", "coat", "layer"],
    types: [/\bjacket\b/, /\bcoat\b/, /blazer/, /overshirt/, /cardigan/],
  },
  {
    id: "neckwear",
    label: "neckwear",
    roles: ["neckwear", "tie"],
    types: [/\btie\b/, /scarf/, /bow\s*tie/],
  },
  {
    id: "belt",
    label: "belt",
    roles: ["belt"],
    types: [/\bbelt\b/],
  },
  {
    id: "accessory",
    label: "accessory",
    roles: ["accessory"],
    types: [/watch/, /\bhat\b/, /pocket\s*square/, /cufflink/],
  },
];

function clampText(value, max) {
  if (value == null) return "";
  return String(value).trim().slice(0, max || MAX_TEXT);
}

function classifySlot(item) {
  var role = String(item.outfitRole || "")
    .toLowerCase()
    .trim();
  var type = String(item.type || "")
    .toLowerCase()
    .trim();

  // Prefer outfitRole — free-text values often equal seed roles.
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    var def = SLOT_DEFS[i];
    for (var r = 0; r < def.roles.length; r++) {
      if (role === def.roles[r] || role.indexOf(def.roles[r]) >= 0) {
        return def.id;
      }
    }
  }

  for (var j = 0; j < SLOT_DEFS.length; j++) {
    var slot = SLOT_DEFS[j];
    for (var t = 0; t < slot.types.length; t++) {
      if (slot.types[t].test(type) || slot.types[t].test(role)) {
        return slot.id;
      }
    }
  }
  return null;
}

function shuffleInPlace(arr, random) {
  var rand = random || Math.random;
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function bucketBySlot(catalog) {
  var buckets = {};
  for (var i = 0; i < SLOT_DEFS.length; i++) {
    buckets[SLOT_DEFS[i].id] = [];
  }
  for (var n = 0; n < (catalog || []).length; n++) {
    var item = catalog[n];
    var slot = classifySlot(item);
    if (!slot) continue;
    buckets[slot].push(item);
  }
  return buckets;
}

/**
 * Build exactly LOOK_COUNT looks. Prefer unused items across looks when the
 * catalog allows; skip empty slots rather than inventing pieces.
 */
function assembleRandomLooks(catalog, options) {
  var opts = options || {};
  var random = opts.random || Math.random;
  var buckets = bucketBySlot(catalog);
  var usedIds = new Set();
  var looks = [];

  for (var lookIndex = 0; lookIndex < LOOK_COUNT; lookIndex++) {
    var lookItems = [];
    for (var s = 0; s < SLOT_DEFS.length; s++) {
      var slotId = SLOT_DEFS[s].id;
      var pool = buckets[slotId] || [];
      if (!pool.length) continue;

      var fresh = pool.filter(function (item) {
        return !usedIds.has(item.itemId);
      });
      var candidates = fresh.length ? fresh : pool.slice();
      shuffleInPlace(candidates, random);
      var pick = candidates[0];
      if (!pick) continue;
      usedIds.add(pick.itemId);
      lookItems.push(pick);
    }

    // If role matching found nothing but the catalog has items, fall back to
    // a small random sample so the UX still shows three looks.
    if (!lookItems.length && (catalog || []).length) {
      var leftover = (catalog || []).filter(function (item) {
        return !usedIds.has(item.itemId);
      });
      if (!leftover.length) leftover = catalog.slice();
      shuffleInPlace(leftover, random);
      var take = Math.min(4, leftover.length);
      for (var t = 0; t < take; t++) {
        usedIds.add(leftover[t].itemId);
        lookItems.push(leftover[t]);
      }
    }

    looks.push({
      lookId: String(lookIndex + 1),
      items: lookItems,
    });
  }

  return looks;
}

function resolveEngine(body) {
  var requested =
    (body && body.engine) || process.env.SUGGEST_ENGINE || "random";
  return String(requested).trim().toLowerCase() || "random";
}

/**
 * Extension point for Bedrock (attrs + IDs only). Not implemented in this PR.
 * Swap by setting SUGGEST_ENGINE=bedrock once IAM + prompt wiring land.
 */
async function assembleWithBedrock(_catalog, _input) {
  var err = new Error("suggest_engine_unavailable");
  err.statusCode = 501;
  throw err;
}

async function enrichLookItems(records) {
  var out = [];
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    var urls = await items.signedFullUrls(record);
    var thumbUrls = await items.signedThumbUrls(record);
    var cutoutUrls = await items.signedCutoutUrls(record);
    out.push(items.publicItem(record, urls, thumbUrls, cutoutUrls));
  }
  return out;
}

async function suggestLooks(user, body) {
  var occasion = clampText(body && body.occasion, MAX_TEXT);
  if (!occasion) {
    throw Object.assign(new Error("missing_occasion"), { statusCode: 400 });
  }
  var weather = clampText(body && body.weather, MAX_TEXT);
  var engine = resolveEngine(body);

  var catalog = await items.listItemRecords(user.sub);
  var input = { occasion: occasion, weather: weather, engine: engine };

  var rawLooks;
  if (engine === "random") {
    rawLooks = assembleRandomLooks(catalog, {
      random: Math.random,
    });
  } else if (engine === "bedrock") {
    // Future: send attrs+IDs only; validate returned IDs against catalog.
    rawLooks = await assembleWithBedrock(catalog, input);
  } else {
    throw Object.assign(new Error("unknown_suggest_engine"), { statusCode: 400 });
  }

  var looks = [];
  for (var i = 0; i < rawLooks.length; i++) {
    looks.push({
      lookId: rawLooks[i].lookId || String(i + 1),
      items: await enrichLookItems(rawLooks[i].items || []),
    });
  }

  // Pad to exactly three looks if an engine returned fewer (random always does).
  while (looks.length < LOOK_COUNT) {
    looks.push({ lookId: String(looks.length + 1), items: [] });
  }
  if (looks.length > LOOK_COUNT) {
    looks = looks.slice(0, LOOK_COUNT);
  }

  return {
    statusCode: 200,
    body: {
      engine: engine,
      occasion: occasion,
      weather: weather,
      looks: looks,
      // Stable request id for future logging / Bedrock tracing.
      suggestionId: crypto.randomUUID(),
    },
  };
}

exports.LOOK_COUNT = LOOK_COUNT;
exports.SLOT_DEFS = SLOT_DEFS;
exports.classifySlot = classifySlot;
exports.assembleRandomLooks = assembleRandomLooks;
exports.assembleWithBedrock = assembleWithBedrock;
exports.suggestLooks = suggestLooks;
