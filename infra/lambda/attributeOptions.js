"use strict";

var { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
var {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
var attrNormalize = require("./attrNormalize");

/** Fields that offer suggested values + free text (UC-19), including brand/model. */
var SUGGESTION_FIELDS = [
  "type",
  "fabric",
  "brandModel",
  "formality",
  "pattern",
  "season",
  "outfitRole",
];

/**
 * Classic menswear-oriented seed suggestions per field.
 * brandModel has no fixed seeds — wardrobe brands vary; every free-text value is remembered.
 * Color is Wada-only (UC-26) — not a free-text suggestion field.
 */
var SEED_OPTIONS = {
  brandModel: [],
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

function normalizeValue(value, field) {
  return attrNormalize.normalizeAttrValue(value, field);
}

/**
 * Seeds ∪ customs for hygiene matching on create/update.
 * @returns {{ options: Object.<string, string[]>, custom: Object.<string, string[]> }}
 */
async function getOptionsForUser(userId) {
  var record = await getCustomRecord(userId);
  var custom = normalizeCustomMap(record && record.custom);
  return {
    options: mergeOptions(custom),
    custom: custom,
  };
}

function emptyCustomMap() {
  var out = {};
  for (var i = 0; i < SUGGESTION_FIELDS.length; i++) {
    out[SUGGESTION_FIELDS[i]] = [];
  }
  return out;
}

function customDedupeKey(field, value) {
  if (field === "brandModel") {
    return attrNormalize.foldForMatch(value, field);
  }
  return normalizeValue(value, field).toLowerCase();
}

function preferCustomValue(field, current, next) {
  if (!current) return next;
  if (field === "brandModel") {
    var curAmp = String(current).indexOf("&") !== -1;
    var nextAmp = String(next).indexOf("&") !== -1;
    if (nextAmp && !curAmp) return next;
    if (curAmp && !nextAmp) return current;
  }
  return current;
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
      var value = normalizeValue(list[j], key);
      if (!value) continue;
      var fold = customDedupeKey(key, value);
      if (!fold) continue;
      if (Object.prototype.hasOwnProperty.call(seen, fold)) {
        var idx = seen[fold];
        cleaned[idx] = preferCustomValue(key, cleaned[idx], value);
        continue;
      }
      seen[fold] = cleaned.length;
      cleaned.push(value);
      if (cleaned.length >= MAX_CUSTOM_PER_FIELD) break;
    }
    out[key] = cleaned;
  }
  return out;
}

function isSeedValue(field, value) {
  var seeds = SEED_OPTIONS[field] || [];
  var fold = normalizeValue(value, field).toLowerCase();
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
      seen[customDedupeKey(key, seed)] = true;
      merged.push(seed);
    }
    var customs = custom[key] || [];
    for (var c = 0; c < customs.length; c++) {
      var value = customs[c];
      var fold = customDedupeKey(key, value);
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
    var value = normalizeValue(src[key], key);
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
    var fold = customDedupeKey(field, next);
    var list = custom[field] || [];
    var foundIdx = -1;
    for (var j = 0; j < list.length; j++) {
      if (customDedupeKey(field, list[j]) === fold) {
        foundIdx = j;
        break;
      }
    }
    if (foundIdx >= 0) {
      var preferred = preferCustomValue(field, list[foundIdx], next);
      if (preferred !== list[foundIdx]) {
        list = list.slice();
        list[foundIdx] = preferred;
        custom[field] = list;
        changed = true;
      }
      continue;
    }
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
exports.getOptionsForUser = getOptionsForUser;
exports.resetDepsForTests = resetDepsForTests;
exports.mergeOptions = mergeOptions;
exports.isSeedValue = isSeedValue;
