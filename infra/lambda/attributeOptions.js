"use strict";

var { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
var {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

/** Fields that offer suggested values + free text (UC-19). brandModel stays free-text only. */
var SUGGESTION_FIELDS = [
  "type",
  "color",
  "fabric",
  "formality",
  "pattern",
  "season",
  "outfitRole",
];

/** Classic menswear-oriented seed suggestions per field. */
var SEED_OPTIONS = {
  type: [
    "jacket",
    "blazer",
    "sport coat",
    "overcoat",
    "raincoat",
    "suit",
    "trousers",
    "chinos",
    "jeans",
    "shirt",
    "dress shirt",
    "polo",
    "sweater",
    "cardigan",
    "vest",
    "tie",
    "bow tie",
    "pocket square",
    "belt",
    "shoes",
    "loafers",
    "oxfords",
    "boots",
    "sneakers",
    "socks",
    "cufflinks",
    "watch",
  ],
  color: [
    "navy",
    "charcoal",
    "black",
    "grey",
    "light grey",
    "white",
    "ivory",
    "cream",
    "beige",
    "brown",
    "olive",
    "forest green",
    "burgundy",
    "wine",
    "light blue",
    "mid blue",
    "pink",
    "purple",
    "tan",
    "camel",
  ],
  fabric: [
    "wool",
    "cashmere",
    "cotton",
    "linen",
    "silk",
    "flannel",
    "tweed",
    "corduroy",
    "denim",
    "leather",
    "suede",
    "cotton-linen",
    "wool-silk",
    "seersucker",
    "gabardine",
    "jersey",
  ],
  formality: [
    "black-tie",
    "formal",
    "business",
    "smart casual",
    "casual",
    "weekend",
    "athletic",
  ],
  pattern: [
    "solid",
    "stripe",
    "pinstripe",
    "check",
    "windowpane",
    "glen check",
    "houndstooth",
    "herringbone",
    "birdseye",
    "paisley",
    "polka dot",
    "floral",
  ],
  season: [
    "all-season",
    "spring",
    "summer",
    "autumn",
    "winter",
    "warm climate",
    "cold climate",
    "rainy",
  ],
  outfitRole: [
    "outerwear",
    "jacket",
    "base",
    "shirt",
    "knitwear",
    "trousers",
    "footwear",
    "neckwear",
    "belt",
    "accessory",
    "layer",
  ],
};

var MAX_CUSTOM_PER_FIELD = 40;
var MAX_ATTR_LEN = 120;

var deps = {
  doc: null,
};

function resetDepsForTests(next) {
  deps.doc = next && next.doc ? next.doc : null;
}

function docClient() {
  if (!deps.doc) {
    deps.doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return deps.doc;
}

function tableName() {
  var name = process.env.ITEMS_TABLE;
  if (!name) {
    throw Object.assign(new Error("items_table_not_configured"), { statusCode: 500 });
  }
  return name;
}

function pkForUser(userId) {
  return "USER#" + userId;
}

function skForAttrOptions() {
  return "META#attrOptions";
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeValue(value) {
  if (value == null) return "";
  return String(value).trim().slice(0, MAX_ATTR_LEN);
}

function emptyCustomMap() {
  var out = {};
  for (var i = 0; i < SUGGESTION_FIELDS.length; i++) {
    out[SUGGESTION_FIELDS[i]] = [];
  }
  return out;
}

function normalizeCustomMap(raw) {
  var src = raw && typeof raw === "object" ? raw : {};
  var out = emptyCustomMap();
  for (var i = 0; i < SUGGESTION_FIELDS.length; i++) {
    var key = SUGGESTION_FIELDS[i];
    var list = Array.isArray(src[key]) ? src[key] : [];
    var seen = Object.create(null);
    var cleaned = [];
    for (var j = 0; j < list.length; j++) {
      var value = normalizeValue(list[j]);
      if (!value) continue;
      var fold = value.toLowerCase();
      if (seen[fold]) continue;
      seen[fold] = true;
      cleaned.push(value);
      if (cleaned.length >= MAX_CUSTOM_PER_FIELD) break;
    }
    out[key] = cleaned;
  }
  return out;
}

function isSeedValue(field, value) {
  var seeds = SEED_OPTIONS[field] || [];
  var fold = normalizeValue(value).toLowerCase();
  if (!fold) return true;
  for (var i = 0; i < seeds.length; i++) {
    if (seeds[i].toLowerCase() === fold) return true;
  }
  return false;
}

function mergeOptions(customMap) {
  var custom = normalizeCustomMap(customMap);
  var out = {};
  for (var i = 0; i < SUGGESTION_FIELDS.length; i++) {
    var key = SUGGESTION_FIELDS[i];
    var seeds = SEED_OPTIONS[key] || [];
    var seen = Object.create(null);
    var merged = [];
    for (var s = 0; s < seeds.length; s++) {
      var seed = seeds[s];
      seen[seed.toLowerCase()] = true;
      merged.push(seed);
    }
    var customs = custom[key] || [];
    for (var c = 0; c < customs.length; c++) {
      var value = customs[c];
      var fold = value.toLowerCase();
      if (seen[fold]) continue;
      seen[fold] = true;
      merged.push(value);
    }
    out[key] = merged;
  }
  return out;
}

async function getCustomRecord(userId) {
  var result = await docClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: { pk: pkForUser(userId), sk: skForAttrOptions() },
    })
  );
  return result.Item || null;
}

async function listAttributeOptions(user) {
  var record = await getCustomRecord(user.sub);
  var custom = record && record.custom ? record.custom : emptyCustomMap();
  return {
    statusCode: 200,
    body: {
      fields: SUGGESTION_FIELDS.slice(),
      options: mergeOptions(custom),
      custom: normalizeCustomMap(custom),
    },
  };
}

/**
 * Persist free-text attribute values that are not in the seed list.
 * Idempotent; case-insensitive dedupe per field.
 */
async function rememberCustomValues(user, attrs) {
  var src = attrs || {};
  var additions = {};
  var any = false;
  for (var i = 0; i < SUGGESTION_FIELDS.length; i++) {
    var key = SUGGESTION_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    var value = normalizeValue(src[key]);
    if (!value || isSeedValue(key, value)) continue;
    additions[key] = value;
    any = true;
  }
  if (!any) return { added: false };

  var existing = await getCustomRecord(user.sub);
  var custom = normalizeCustomMap(existing && existing.custom);
  var changed = false;
  for (var field of Object.keys(additions)) {
    var next = additions[field];
    var fold = next.toLowerCase();
    var list = custom[field] || [];
    var found = false;
    for (var j = 0; j < list.length; j++) {
      if (list[j].toLowerCase() === fold) {
        found = true;
        break;
      }
    }
    if (found) continue;
    list = [next].concat(list).slice(0, MAX_CUSTOM_PER_FIELD);
    custom[field] = list;
    changed = true;
  }
  if (!changed) return { added: false };

  var ts = nowIso();
  var item = {
    pk: pkForUser(user.sub),
    sk: skForAttrOptions(),
    userId: user.sub,
    custom: custom,
    updatedAt: ts,
    createdAt: (existing && existing.createdAt) || ts,
  };
  await docClient().send(new PutCommand({ TableName: tableName(), Item: item }));
  return { added: true, custom: custom };
}

exports.SUGGESTION_FIELDS = SUGGESTION_FIELDS;
exports.SEED_OPTIONS = SEED_OPTIONS;
exports.listAttributeOptions = listAttributeOptions;
exports.rememberCustomValues = rememberCustomValues;
exports.resetDepsForTests = resetDepsForTests;
exports.mergeOptions = mergeOptions;
exports.isSeedValue = isSeedValue;
