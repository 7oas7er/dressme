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
  assert.match(catalog, /"brandModel"/);
  assert.match(catalog, /datalist/);
  assert.match(catalog, /listAttributeOptions/);
  assert.match(catalog, /Suggested values — or type your own/);
  assert.match(apiSrc, /\/api\/attribute-options/);
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(useCases, /UC-19 — Suggested values with free-text/);
  assert.match(useCases, /brand\/model/);
});

test("catalog overview prefers thumbUrl (UC-20)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /layerImageUrl\(item,\s*\{\s*purpose:\s*"catalog"/);
  assert.match(catalog, /loadFullItem/);
  assert.match(apiSrc, /\/api\/photos\/backfill-thumbs/);
  assert.match(useCases, /UC-20 — Fast catalog thumbnails/);
});

test("cutouts stopped: originals preferred; backfill endpoint noops", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const lookLayout = fs.readFileSync(path.join(root, "web/src/lookLayout.js"), "utf8");
  const lambdaApi = fs.readFileSync(path.join(root, "infra/lambda/api.js"), "utf8");
  const itemsSrc = fs.readFileSync(path.join(root, "infra/lambda/items.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(lookLayout, /never prefer cutout/);
  assert.match(lookLayout, /purpose === "strip"/);
  assert.doesNotMatch(catalog, /maybeBackfillCutouts/);
  assert.doesNotMatch(catalog, /catalog-cutout/);
  assert.match(apiSrc, /\/api\/photos\/backfill-cutouts/);
  assert.match(lambdaApi, /backfill-cutouts/);
  assert.match(itemsSrc, /CUTOUTS_ENABLED = false/);
  assert.match(useCases, /UC-24/);
  assert.match(useCases, /not required|Later|demoted|optional/i);
});

test("add/edit form keeps Brand/model on shared row baseline (UC-21)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /field-title/);
  assert.match(catalog, /Brand \/ model/);
  assert.match(styles, /\.form-grid\s*\{[^}]*align-items:\s*start/s);
  assert.match(styles, /\.form-grid\s*>\s*label\s*\{[^}]*align-content:\s*start/s);
  assert.match(useCases, /UC-21 — Brand\/model field alignment/);
});

test("item detail/edit photos are large with click-to-enlarge (UC-23)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /function openPhotoLightbox/);
  assert.match(catalog, /photoOpenButton/);
  assert.match(catalog, /photo-lightbox/);
  assert.match(catalog, /Escape/);
  assert.match(styles, /\.detail-photos\s*\{[^}]*minmax\(280px/s);
  assert.match(styles, /\.edit-photos\s*\{[^}]*minmax\(240px/s);
  assert.match(styles, /\.photo-lightbox/);
  assert.match(useCases, /UC-23 — Larger photos on item detail with click-to-enlarge/);
});

test("catalog list exposes attribute filters above the grid (UC-07)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /collectAttributeFilterValues/);
  assert.match(catalog, /applyAttributeFilters/);
  assert.match(catalog, /Clear filters/);
  assert.match(catalog, /Filter catalog by attributes/);
  assert.match(catalog, /renderFilters/);
  assert.match(styles, /\.filter-bar/);
  assert.match(styles, /\.filter-grid/);
  assert.match(useCases, /UC-07 — Filter the catalog by attributes/);
});

test("add/edit form exposes Analyze photo assist (UC-25)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const lambdaApi = fs.readFileSync(path.join(root, "infra/lambda/api.js"), "utf8");
  const analyzeSrc = fs.readFileSync(path.join(root, "infra/lambda/analyze.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /Analyze photo/);
  assert.match(catalog, /Re-analyze/);
  assert.match(catalog, /draftFromProposal/);
  assert.match(catalog, /Filled the form from the photo/);
  assert.doesNotMatch(catalog, /Apply to form/);
  assert.doesNotMatch(catalog, /assistAiContext|name: `assist-/);
  assert.doesNotMatch(catalog, /assistAnswers|Notes \/ answers for the assistant/);
  assert.match(
    catalog,
    /AI context \(edit anytime; Analyze fills\/updates from the photo\)/
  );
  assert.match(catalog, /name: "aiContext"/);
  assert.match(catalog, /hints: aiContext/);
  assert.match(catalog, /runAnalyze|analyzeItemPhoto/);
  assert.match(apiSrc, /\/api\/items\/analyze/);
  assert.match(lambdaApi, /items\/analyze/);
  assert.match(analyzeSrc, /ConverseCommand|bedrock/i);
  assert.match(useCases, /UC-25 — Add-time AI catalog assist/);
});

test("suggest outfits flow and SVG mannequin look cards (UC-04–06)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const suggest = fs.readFileSync(path.join(root, "web/src/suggest.js"), "utf8");
  const lookLayout = fs.readFileSync(path.join(root, "web/src/lookLayout.js"), "utf8");
  const lookCard = fs.readFileSync(path.join(root, "web/src/lookCard.js"), "utf8");
  const mannequinColor = fs.readFileSync(
    path.join(root, "web/src/mannequinColor.js"),
    "utf8"
  );
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /Suggest outfits/);
  assert.match(catalog, /openSuggest|view === "suggest"/);
  assert.match(catalog, /runSuggest/);
  assert.match(catalog, /renderLookCard/);
  assert.match(catalog, /Nothing is recorded|does not record worn/);
  assert.match(catalog, /name: "occasion"/);
  assert.match(catalog, /name: "weather"/);
  assert.match(suggest, /lookHeadline|lookSummary/);
  assert.match(lookLayout, /itemToSlot|buildLookVisual|layerImageUrl/);
  assert.match(lookCard, /look-hero|look-strip|look-mannequin/);
  assert.match(lookCard, /mn-wash|sampleThumb|100 240/);
  assert.match(mannequinColor, /resolveFillColor|resolvePatternHint/);
  assert.ok(
    fs.existsSync(path.join(root, "web/src/thumbSample.js")),
    "Phase 1 thumb sample helper"
  );
  assert.match(apiSrc, /\/api\/suggest/);
  assert.match(apiSrc, /suggestOutfits/);
  assert.match(styles, /\.look-hero/);
  assert.match(styles, /\.look-mannequin/);
  assert.match(styles, /\.look-strip/);
  assert.match(styles, /\.looks-grid/);
  assert.match(useCases, /UC-04 — Request outfit suggestions/);
  assert.match(useCases, /UC-05 — View a look as an SVG mannequin/);
  assert.match(useCases, /UC-06 — Pick among three looks/);
});
