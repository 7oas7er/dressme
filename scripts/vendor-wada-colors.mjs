#!/usr/bin/env node
/**
 * Regenerate DressMe-shaped Wada Vol. 1 palette from mattdesl npm package.
 * Usage (from repo root):
 *   npm pack dictionary-of-colour-combinations@1.0.2 --pack-destination /tmp
 *   tar -xzf /tmp/dictionary-of-colour-combinations-1.0.2.tgz -C /tmp
 *   node scripts/vendor-wada-colors.mjs /tmp/package/colors.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/vendor-wada-colors.mjs <upstream-colors.json>");
  process.exit(1);
}

const upstream = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!Array.isArray(upstream) || upstream.length !== 159) {
  console.error("Expected 159 colours in upstream colors.json, got", upstream.length);
  process.exit(1);
}

function hexToHsl(hex) {
  const h = String(hex).replace("#", "").toLowerCase();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hDeg = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hDeg = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hDeg = (b - r) / d + 2;
        break;
      default:
        hDeg = (r - g) / d + 4;
        break;
    }
    hDeg /= 6;
  }
  return {
    h: Math.round(hDeg * 360),
    s: Math.round(s * 1000) / 1000,
    l: Math.round(l * 1000) / 1000,
  };
}

const colors = upstream.map((c, i) => {
  const hex = String(c.hex || "").toLowerCase();
  return {
    id: `wada:v1:${i}`,
    name: c.name,
    hex,
    hsl: hexToHsl(hex),
  };
});

const payload = {
  version: 1,
  source: "mattdesl/dictionary-of-colour-combinations",
  npmVersion: "1.0.2",
  license: "MIT",
  colors,
};

const jsonPath = path.join(root, "web/src/data/wada-colors.v1.json");
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");

const byIdEntries = colors
  .map(
    (c) =>
      `  ${JSON.stringify(c.id)}: { name: ${JSON.stringify(c.name)}, hex: ${JSON.stringify(c.hex)} }`
  )
  .join(",\n");

const lambdaSrc = `"use strict";

/**
 * DressMe Wada Vol. 1 palette twin (validation + resolve).
 * Generated from mattdesl/dictionary-of-colour-combinations@1.0.2 (MIT).
 * Keep in sync with web/src/data/wada-colors.v1.json — regenerate via scripts/vendor-wada-colors.mjs.
 */

var BY_ID = {
${byIdEntries}
};

var KNOWN_WADA_IDS = new Set(Object.keys(BY_ID));
var MAX_WADA_COLORS = 4;

/**
 * Normalize create/update body.wadaColorIds.
 * @returns {string[]|null} null when omitted from the body
 * @throws {Error} statusCode 400 invalid_wada_color | too_many_wada_colors
 */
function normalizeWadaColorIds(value) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    var err = new Error("invalid_wada_color");
    err.statusCode = 400;
    throw err;
  }
  if (value.length > MAX_WADA_COLORS) {
    var tooMany = new Error("too_many_wada_colors");
    tooMany.statusCode = 400;
    throw tooMany;
  }
  var out = [];
  var seen = Object.create(null);
  for (var i = 0; i < value.length; i++) {
    var id = value[i] == null ? "" : String(value[i]);
    if (!KNOWN_WADA_IDS.has(id)) {
      var bad = new Error("invalid_wada_color");
      bad.statusCode = 400;
      throw bad;
    }
    if (seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function resolveWadaColor(id) {
  return BY_ID[id] || null;
}

function wadaNamesForSearch(ids) {
  if (!ids || !ids.length) return "";
  var names = [];
  for (var i = 0; i < ids.length; i++) {
    var row = BY_ID[ids[i]];
    if (row && row.name) names.push(row.name);
  }
  return names.join(" ");
}

exports.KNOWN_WADA_IDS = KNOWN_WADA_IDS;
exports.MAX_WADA_COLORS = MAX_WADA_COLORS;
exports.BY_ID = BY_ID;
exports.normalizeWadaColorIds = normalizeWadaColorIds;
exports.resolveWadaColor = resolveWadaColor;
exports.wadaNamesForSearch = wadaNamesForSearch;
`;

fs.writeFileSync(path.join(root, "infra/lambda/wadaPalette.js"), lambdaSrc);
console.log("Wrote", jsonPath, `(${colors.length} colours)`);
console.log("Wrote infra/lambda/wadaPalette.js");
