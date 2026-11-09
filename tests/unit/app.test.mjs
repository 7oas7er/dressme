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

test("edit form sets catalog photo via primaryPhotoId (UC-18)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const itemsSrc = fs.readFileSync(path.join(root, "infra/lambda/items.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  const lookLayout = fs.readFileSync(path.join(root, "web/src/lookLayout.js"), "utf8");
  assert.match(catalog, /async function setPrimaryPhoto/);
  assert.match(catalog, /primaryPhotoId:\s*photoId/);
  assert.match(catalog, /photo-primary/);
  assert.match(catalog, /Use as catalog photo/);
  assert.match(catalog, /primaryStarIcon/);
  // Star hidden when already photos[0]; no drag-reorder UI.
  assert.match(catalog, /existing\[0\]\.photoId !== photo\.photoId/);
  assert.doesNotMatch(catalog, /drag-reorder|sortable|Sortable/);
  assert.match(styles, /\.edit-photo \.photo-primary/);
  assert.match(styles, /top:\s*0\.45rem/);
  assert.match(itemsSrc, /body\.primaryPhotoId|primaryPhotoId/);
  assert.match(useCases, /top-right star control/);
  assert.match(useCases, /do not auto-become first/);
  // Overview still keys off first displayable photo (no separate primary flag).
  assert.match(lookLayout, /function firstPhoto/);
});

test("edit form rotates ready photos client-side then same-photoId replace (UC-18)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const rotateSrc = fs.readFileSync(path.join(root, "web/src/rotateImage.js"), "utf8");
  const lambdaApi = fs.readFileSync(path.join(root, "infra/lambda/api.js"), "utf8");
  const itemsSrc = fs.readFileSync(path.join(root, "infra/lambda/items.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /rotateImageFromUrl/);
  assert.match(catalog, /async function rotateEditPhoto/);
  assert.match(catalog, /photo-rotate/);
  assert.match(catalog, /Rotate photo 90 degrees clockwise/);
  // CW arrow path (not the old CCW rotate-left glyph).
  assert.match(catalog, /M12 5V2l4 4-4 4V7/);
  assert.doesNotMatch(catalog, /M12 5V2L8 6l4 4V7/);
  assert.match(catalog, /replacePhotos:\s*\[\s*\{\s*photoId,\s*contentType:\s*"image\/jpeg"/);
  assert.doesNotMatch(
    catalog,
    /rotateEditPhoto[\s\S]*removePhotoIds:\s*\[\s*photoId\s*\]/
  );
  assert.match(itemsSrc, /body\.replacePhotos|replacePhotos/);
  assert.match(rotateSrc, /ROTATE_JPEG_QUALITY\s*=\s*0\.9/);
  assert.match(rotateSrc, /createImageBitmap/);
  // Bypass non-CORS <img> disk cache that makes Safari throw "Load failed".
  assert.match(rotateSrc, /cache:\s*["']no-store["']/);
  assert.match(rotateSrc, /mode:\s*["']cors["']/);
  assert.match(rotateSrc, /image_cors_failed/);
  assert.doesNotMatch(apiSrc, /function rotatePhoto|\/photos\/.*\/rotate/);
  assert.doesNotMatch(lambdaApi, /\/rotate\$|rotatePhoto/);
  assert.match(useCases, /browser rotates the image immediately/);
  assert.match(useCases, /same photo id/);
});

test("add/edit forms use suggested values with free text (UC-19)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  assert.match(catalog, /SUGGESTION_KEYS/);
  assert.match(catalog, /"brandModel"/);
  assert.match(catalog, /datalist/);
  assert.match(catalog, /listAttributeOptions/);
  assert.match(catalog, /pick or type/);
  assert.match(catalog, /attr-hygiene-chip/);
  assert.match(catalog, /Did you mean/);
  assert.match(catalog, /matchAttrOption/);
  assert.match(apiSrc, /\/api\/attribute-options/);
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(useCases, /UC-19 — Suggested values with free-text/);
  assert.match(useCases, /brand\/model/);
  assert.match(useCases, /Did you mean/);
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

test("item detail shows catalog entry date from createdAt (UC-02)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const itemsSrc = fs.readFileSync(path.join(root, "infra/lambda/items.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /formatEntryDate/);
  assert.match(catalog, /detail-entry-date/);
  assert.match(catalog, /Entry date/);
  assert.match(catalog, /item\.createdAt/);
  // Catalog card sub: Brand · Wada name (else free-text color); no outfit role.
  assert.match(catalog, /catalogCardSubLine/);
  assert.doesNotMatch(
    catalog,
    /className:\s*"sub"[\s\S]{0,80}item\.color.*item\.outfitRole/
  );
  assert.match(styles, /\.detail-actions/);
  assert.match(styles, /\.detail-entry-date/);
  assert.match(itemsSrc, /createdAt:\s*ts/);
  assert.match(itemsSrc, /createdAt:\s*item\.createdAt/);
  assert.match(useCases, /entry date/i);
  assert.match(useCases, /Brand · color/);
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
  assert.match(catalog, /dressme\.catalog\.filtersOpen/);
  assert.match(catalog, /readFiltersOpen|filtersOpen/);
  assert.match(catalog, /Hide filters|Filters/);
  assert.match(catalog, /filter-fold-toggle/);
  assert.match(styles, /\.filter-fold/);
  assert.match(styles, /\.filter-bar/);
  assert.match(styles, /\.filter-grid/);
  assert.match(styles, /\.topbar-actions[\s\S]*margin-inline-start/);
  assert.match(useCases, /UC-07 — Filter the catalog by attributes/);
  assert.match(useCases, /foldable filter pane/);
});

test("catalog chrome: Catalog / Add item / DressMe nav, Sign out with Imprint, Appraise", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  assert.match(
    catalog,
    /navButton\("catalog", "Catalog"[\s\S]*navButton\("add", "Add item"[\s\S]*navButton\("dressme", "DressMe"/
  );
  assert.match(
    catalog,
    /className: "page-footer"[\s\S]*imprint\.html[\s\S]*className: "secondary sign-out"/
  );
  assert.match(catalog, /catalog-count/);
  assert.match(catalog, /itemCountLabel/);
  assert.doesNotMatch(catalog, /Wardrobe catalog/);
  assert.doesNotMatch(catalog, /Back to catalog/);
  assert.doesNotMatch(catalog, /Analyze photo/);
  assert.match(catalog, /return "Appraise"/);
  assert.match(styles, /\.catalog-count/);
  assert.match(styles, /\.page-footer/);
  assert.match(styles, /\.page-footer[\s\S]*justify-content:\s*space-between/);
});

test("in-app History: pushState/popstate restore view; logout only via Sign out", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(root, "web/src/auth.js"), "utf8");
  const mainSrc = fs.readFileSync(path.join(root, "web/src/main.js"), "utf8");
  assert.match(catalog, /history\.pushState/);
  assert.match(catalog, /history\.replaceState/);
  assert.match(catalog, /addEventListener\("popstate"/);
  assert.match(catalog, /restoreFromHistory|dressme:\s*1/);
  assert.match(catalog, /skipHistory/);
  // popstate path must not clear session or call logout.
  assert.doesNotMatch(
    catalog,
    /onPopState[\s\S]{0,400}onLogout|onPopState[\s\S]{0,400}clearSession|onPopState[\s\S]{0,400}logout\(/
  );
  assert.match(mainSrc, /onLogout:\s*\(\)\s*=>\s*auth\.logout/);
  assert.match(authSrc, /export function logout/);
  assert.match(
    catalog,
    /className: "secondary sign-out"[\s\S]*onClick:\s*onLogout/
  );
});

test("add/edit form exposes Appraise assist (UC-25)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const apiSrc = fs.readFileSync(path.join(root, "web/src/api.js"), "utf8");
  const lambdaApi = fs.readFileSync(path.join(root, "infra/lambda/api.js"), "utf8");
  const analyzeSrc = fs.readFileSync(path.join(root, "infra/lambda/analyze.js"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /text: "Appraise"|return "Appraise"/);
  assert.match(catalog, /Re-appraise/);
  assert.doesNotMatch(catalog, /Analyze photo/);
  assert.match(catalog, /draftFromProposal/);
  assert.match(catalog, /Filled the form from the photo/);
  assert.doesNotMatch(catalog, /Apply to form/);
  assert.doesNotMatch(catalog, /assistAiContext|name: `assist-/);
  assert.doesNotMatch(catalog, /assistAnswers|Notes \/ answers for the assistant/);
  assert.match(catalog, /text: "AI context"/);
  assert.match(catalog, /name: "aiContext"/);
  assert.match(catalog, /hints: aiContext/);
  assert.match(catalog, /runAnalyze|analyzeItemPhoto/);
  assert.match(apiSrc, /\/api\/items\/analyze/);
  assert.match(lambdaApi, /items\/analyze/);
  assert.match(analyzeSrc, /ConverseCommand|bedrock/i);
  assert.match(useCases, /UC-25 — Add-time AI catalog assist/);
  assert.match(useCases, /Appraise/);
});

test("mobile add UX: camera-first, sticky Save, Add next (UC-01 phone)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.match(catalog, /Take photo/);
  assert.match(catalog, /From library/);
  assert.match(catalog, /capture:\s*"environment"/);
  assert.match(catalog, /pendingPhotos/);
  assert.match(catalog, /pending-photo-strip|renderPendingPhotoStrip/);
  assert.match(catalog, /removePendingPhoto/);
  assert.match(catalog, /hasAnalyzablePhoto/);
  assert.match(catalog, /form-sticky-actions|renderFormStickyActions/);
  assert.match(catalog, /assist-early-actions/);
  assert.match(catalog, /Save & add next/);
  assert.match(catalog, /Saved\. Add next piece\./);
  assert.doesNotMatch(catalog, /softPrefillFromPayload|type\/brand kept as a starting point/);
  assert.match(catalog, /Add next/);
  // Single Appraise near AI context — not duplicated in the sticky Save bar.
  assert.match(catalog, /assist-early-actions[\s\S]*analyzeButtonLabel/);
  assert.doesNotMatch(
    catalog,
    /form-sticky-actions[\s\S]*analyzeButtonLabel|aria-label": "Save and appraise"/
  );
  // AI context stays a plain textarea; no in-app Mic / Web Speech.
  assert.match(catalog, /name: "aiContext"/);
  assert.match(catalog, /syncAiContextDraft/);
  assert.doesNotMatch(catalog, /SpeechRecognition|webkitSpeechRecognition|ai-context-mic|getUserMedia/);
  assert.doesNotMatch(styles, /\.ai-context-mic|\.mic-status|\.mic-listening/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /\.form-sticky-actions/);
  assert.match(styles, /\.pending-photo-strip/);
  assert.match(styles, /font-size:\s*16px/);
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(useCases, /camera-first|Add next|sticky/i);
  assert.match(useCases, /keyboard dictation/i);
  assert.doesNotMatch(useCases, /Mic control|Web Speech API|microphone=\(self\)/);
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
  assert.match(catalog, /navButton\("dressme", "DressMe"/);
  assert.match(catalog, /openSuggest|view === "suggest"/);
  assert.match(catalog, /runSuggest/);
  assert.match(catalog, /renderLookCard/);
  assert.match(catalog, /Nothing is recorded|does not record worn/);
  assert.match(catalog, /name: "context"/);
  assert.doesNotMatch(catalog, /name: "occasion"/);
  assert.doesNotMatch(catalog, /name: "weather"/);
  assert.match(catalog, /AI suggestions from your catalog/);
  assert.match(suggest, /lookHeadline|lookSummary/);
  assert.match(lookLayout, /itemToSlot|buildLookVisual|layerImageUrl/);
  assert.match(lookLayout, /primaryWadaHex|fillFromWada/);
  assert.match(lookCard, /look-hero|look-strip|look-mannequin/);
  assert.match(lookCard, /look-rationale/);
  assert.match(lookCard, /mn-wash|sampleThumb|100 240/);
  assert.match(lookCard, /fillFromWada/);
  assert.match(mannequinColor, /resolveFillColor|resolvePatternHint/);
  assert.ok(
    fs.existsSync(path.join(root, "web/src/thumbSample.js")),
    "Phase 1 thumb sample helper"
  );
  assert.match(apiSrc, /\/api\/suggest/);
  assert.match(apiSrc, /suggestOutfits/);
  assert.match(apiSrc, /context/);
  // Dual-write occasion until stg Lambda zip is applied (missing_occasion).
  assert.match(apiSrc, /occasion:\s*context/);
  assert.match(catalog, /missing_occasion/);
  assert.match(styles, /\.look-hero/);
  assert.match(styles, /\.look-mannequin/);
  assert.match(styles, /\.look-strip/);
  assert.match(styles, /\.look-rationale/);
  assert.match(styles, /\.looks-grid/);
  assert.match(useCases, /UC-04 — Request outfit suggestions/);
  assert.match(useCases, /UC-05 — View a look as an SVG mannequin/);
  assert.match(useCases, /UC-06 — Pick among three looks/);
  assert.match(useCases, /UC-09 — Short rationale per look/);
});

test("Wada Slice A: picker, catalog swatch, API ids, attribution (UC-26/27)", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const itemsSrc = fs.readFileSync(path.join(root, "infra/lambda/items.js"), "utf8");
  const imprint = fs.readFileSync(path.join(root, "web/imprint.html"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.ok(fs.existsSync(path.join(root, "web/src/data/wada-colors.v1.json")));
  assert.ok(fs.existsSync(path.join(root, "web/src/wadaPalette.js")));
  assert.ok(fs.existsSync(path.join(root, "infra/lambda/wadaPalette.js")));
  assert.ok(fs.existsSync(path.join(root, "THIRD_PARTY.md")));
  assert.match(catalog, /Wada reference/);
  assert.match(catalog, /renderWadaField|wadaColorIds|wada-swatch/);
  assert.match(catalog, /wadaPrimarySwatch|lede-row/);
  assert.match(catalog, /Browse palette|Clear/);
  // Swatch fills must use CSSOM (cssText), not style="" — CSP blocks unsafe-inline.
  assert.match(catalog, /style\.cssText/);
  assert.match(styles, /\.wada-swatch|\.wada-field|\.sub-row|\.lede-row/);
  assert.match(itemsSrc, /applyWadaColorIds|wadaColorIds/);
  assert.match(itemsSrc, /wadaPalette/);
  assert.match(imprint, /dictionary-of-colour-combinations|THIRD_PARTY/);
  assert.match(useCases, /UC-26/);
  assert.match(useCases, /UC-27/);
  assert.match(useCases, /item detail/);
});

test("Wada Slice B: client Lab nearest propose after Appraise / from photo", () => {
  const catalog = fs.readFileSync(path.join(root, "web/src/catalog.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const useCases = fs.readFileSync(path.join(root, "docs/use-cases.md"), "utf8");
  assert.ok(fs.existsSync(path.join(root, "web/src/wadaNearest.js")));
  assert.ok(fs.existsSync(path.join(root, "tests/unit/wadaNearest.test.mjs")));
  assert.match(catalog, /proposeWadaFromPhoto|nearestWadaColor|sampleThumb/);
  assert.match(catalog, /Replace from photo|From photo/);
  assert.match(catalog, /wada-from-photo/);
  // Still CSP-safe for dynamic swatch fills.
  assert.match(catalog, /style\.cssText/);
  assert.doesNotMatch(catalog, /setAttribute\(\s*["']style["']/);
  assert.match(styles, /\.wada-from-photo|\.wada-field-actions/);
  assert.match(useCases, /nearest|from photo|Slice B/i);
});
