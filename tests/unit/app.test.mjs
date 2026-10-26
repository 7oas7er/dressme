import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webMain = path.join(root, "web/src/main.js");
const builtIndex = path.join(root, "dressme/index.html");

test("SPA source exports boot entry", () => {
  const src = fs.readFileSync(webMain, "utf8");
  assert.match(src, /export\s*\{\s*boot\s*\}/);
  assert.match(src, /fetchConfig/);
  assert.match(src, /renderCatalogApp/);
});

test("built index includes DressMe app mount", () => {
  assert.ok(fs.existsSync(builtIndex), "run: cd web && npm ci && npm run build");
  const html = fs.readFileSync(builtIndex, "utf8");
  assert.match(html, /id="app"/);
  assert.match(html, /DressMe/i);
});

test("edit form supports current-photo remove (UC-18)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  assert.match(catalog, /Current photos/);
  assert.match(catalog, /removePhotoIds/);
  assert.match(catalog, /function removePhoto|async function removePhoto/);
  assert.match(catalog, /edit-photos/);
});

test("add/edit forms use suggested values with free text (UC-19)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  assert.match(catalog, /SUGGESTION_KEYS/);
  assert.match(catalog, /datalist/);
  assert.match(catalog, /listAttributeOptions/);
  assert.match(catalog, /Suggested values — or type your own/);
  assert.match(apiSrc, /\/api\/attribute-options/);
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(useCases, /UC-19 — Suggested values with free-text/);
});
