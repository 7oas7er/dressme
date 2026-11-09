import * as api from "./api.js";
import { matchAttrOption, normalizeAttrValue } from "./attrNormalize.js";
import { layerImageUrl } from "./lookLayout.js";
import { renderLookCard } from "./lookCard.js";
import { rotateImageFromUrl } from "./rotateImage.js";
import { sampleThumb } from "./thumbSample.js";
import {
  MAX_WADA_COLORS,
  getWadaColor,
  normalizeWadaColorIdsClient,
  primaryWadaId,
  resolveWadaName,
  searchWadaColors,
} from "./wadaPalette.js";
import { nearestWadaColor } from "./wadaNearest.js";

/** Fields that use suggested values + free text (UC-19), including brand/model. */
const SUGGESTION_KEYS = new Set([
  "type",
  "fabric",
  "brandModel",
  "formality",
  "pattern",
  "season",
  "outfitRole",
]);

/** Add/Edit form fields — color is Wada-only (UC-26), not free text. */
const ATTR_FIELDS = [
  { key: "type", label: "Type", placeholder: "jacket, shirt, shoes…" },
  { key: "fabric", label: "Fabric", placeholder: "wool" },
  { key: "brandModel", label: "Brand / model", placeholder: "maker or model" },
  { key: "formality", label: "Formality", placeholder: "business, casual…" },
  { key: "pattern", label: "Pattern", placeholder: "solid, stripe…" },
  { key: "season", label: "Season / climate", placeholder: "all-season" },
  { key: "outfitRole", label: "Outfit role", placeholder: "outerwear, base…" },
];

/** UC-07 filter categories; `color` = primary Wada English name in the wardrobe. */
const FILTER_FIELDS = [
  { key: "type", label: "Type" },
  { key: "color", label: "Color" },
  { key: "fabric", label: "Fabric" },
  { key: "brandModel", label: "Brand / model" },
  { key: "formality", label: "Formality" },
  { key: "pattern", label: "Pattern" },
  { key: "season", label: "Season / climate" },
  { key: "outfitRole", label: "Outfit role" },
];

/** Primary Wada English name, or "" when unset / unresolved. */
function primaryWadaName(item) {
  const primaryId = primaryWadaId(item && item.wadaColorIds);
  return primaryId ? resolveWadaName(primaryId) : "";
}

/**
 * Catalog card sub line (UC-02): `Brand · color`.
 * Color = primary Wada English name only (omit segment when unset).
 * Missing brand → Wada name only; both empty → "".
 */
export function catalogCardSubLine(item) {
  const brand = String((item && item.brandModel) || "").trim();
  const color = primaryWadaName(item);
  if (brand && color) return `${brand} · ${color}`;
  return color || brand || "";
}

/** Unique non-empty attribute values present in the wardrobe (UC-07). */
export function collectAttributeFilterValues(items) {
  const out = {};
  for (const field of FILTER_FIELDS) {
    const seen = new Set();
    for (const item of items || []) {
      const value =
        field.key === "color"
          ? primaryWadaName(item)
          : String(item[field.key] || "").trim();
      if (value) seen.add(value);
    }
    out[field.key] = Array.from(seen).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/** AND across selected attribute categories (UC-07). Empty selection = any. */
export function applyAttributeFilters(items, filters) {
  const active = filters || {};
  return (items || []).filter((item) => {
    for (const field of FILTER_FIELDS) {
      const selected = String(active[field.key] || "").trim();
      if (!selected) continue;
      const value =
        field.key === "color"
          ? primaryWadaName(item)
          : String(item[field.key] || "").trim();
      if (value !== selected) return false;
    }
    return true;
  });
}

function filtersActive(filters) {
  return FILTER_FIELDS.some((field) => String((filters || {})[field.key] || "").trim());
}

function emptyFilters() {
  const next = {};
  for (const field of FILTER_FIELDS) next[field.key] = "";
  return next;
}

const FILTERS_OPEN_KEY = "dressme.catalog.filtersOpen";

/** Folded by default; sessionStorage remembers expand/collapse for the tab. */
function readFiltersOpen() {
  try {
    return sessionStorage.getItem(FILTERS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFiltersOpen(open) {
  try {
    sessionStorage.setItem(FILTERS_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Private mode / quota — fold state stays in-memory only.
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style" && value != null) {
      // CSP style-src has no 'unsafe-inline' — HTML style="" is blocked on
      // staging/prod. CSSOM cssText still applies (Wada swatch fills).
      node.style.cssText = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value != null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function thumbUrl(item) {
  // Option D: catalog uses photographic thumbs/originals (cutouts no longer preferred).
  return layerImageUrl(item, { purpose: "catalog" });
}

/** Primary Wada true-color circle (catalog + detail). Omit when unset. */
function wadaPrimarySwatch(wadaColorIds) {
  const primaryId = primaryWadaId(wadaColorIds);
  const wada = primaryId ? getWadaColor(primaryId) : null;
  if (!wada) return null;
  return el("span", {
    className: "wada-swatch",
    // cssText via el() — CSP blocks style="" attributes (#85).
    style: `background:${wada.hex}`,
    title: wada.name,
    "aria-label": `Wada ${wada.name}`,
  });
}

/** Catalog entry day from Dynamo `createdAt` (Europe/Berlin calendar date). */
function formatEntryDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}

/** UC-23: full-res lightbox; dismiss via backdrop, close control, or Escape. */
function openPhotoLightbox(url, alt) {
  if (!url) return;
  const existing = document.querySelector(".photo-lightbox");
  if (existing) existing.remove();

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  const closeBtn = el("button", {
    type: "button",
    className: "secondary photo-lightbox-close",
    text: "Close",
    "aria-label": "Close enlarged photo",
    onClick: (event) => {
      event.stopPropagation();
      close();
    },
  });

  const inner = el("div", { className: "photo-lightbox-inner" }, [
    closeBtn,
    el("img", { src: url, alt: alt || "Enlarged photo" }),
  ]);
  inner.addEventListener("click", (event) => event.stopPropagation());

  const overlay = el(
    "div",
    {
      className: "photo-lightbox",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Enlarged photo",
      onClick: close,
    },
    [inner]
  );

  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  closeBtn.focus();
}

function photoOpenButton(url, alt) {
  return el(
    "button",
    {
      type: "button",
      className: "photo-open",
      "aria-label": "Enlarge photo",
      onClick: () => openPhotoLightbox(url, alt),
    },
    [el("img", { src: url, alt: alt || "" })]
  );
}

/** Lower-right edit overlay: CW rotate arrow (inline SVG, no emoji). */
function rotateArrowIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "photo-rotate-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // CW arrow (previous path was CCW / rotate-left); keep +90° CW pixel rotate.
  path.setAttribute(
    "d",
    "M12 5V2l4 4-4 4V7c-2.76 0-5 2.24-5 5a5 5 0 0 0 8.9 3.1l1.4 1.4A7 7 0 0 1 5 12c0-3.87 3.13-7 7-7z"
  );
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/** Top-right edit overlay: filled star — set catalog (first) photo. */
function primaryStarIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "photo-primary-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
  );
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/** Compress a local image for one Bedrock analyze call (cost + payload). */
function compressImageFile(file, { maxEdge = 1024, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas_unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const comma = dataUrl.indexOf(",");
      resolve({
        imageBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
        contentType: "image/jpeg",
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}

function emptyAssist() {
  return {
    proposal: null,
    analyzing: false,
  };
}

/** Values applied from AI assist (or in-progress edits) that must survive paint(). */
function emptyFormDraft() {
  return null;
}

let pendingPhotoSeq = 0;

function revokePendingPhoto(entry) {
  if (entry && entry.url) URL.revokeObjectURL(entry.url);
}

function clearPendingPhotos(list) {
  for (const entry of list || []) revokePendingPhoto(entry);
  return [];
}

export function renderCatalogApp(root, { onLogout }) {
  const state = {
    items: [],
    query: "",
    filters: emptyFilters(),
    /** Attribute filter pane; folded by default (sessionStorage). */
    filtersOpen: readFiltersOpen(),
    view: "list", // list | form | detail | suggest
    editing: null,
    status: "",
    error: "",
    busy: false,
    /** photoId currently rotating on edit (busy tile highlight). */
    rotatingPhotoId: null,
    attributeOptions: {},
    /** Per-field custom lists from GET /api/attribute-options (for seed vs custom rank). */
    attributeCustom: {},
    /**
     * Phase 1 hygiene chips: field → { suggestion } while visible.
     * Dismissals: field → normalized value Frank kept (session-scoped).
     */
    attrChips: {},
    attrChipDismissed: {},
    assist: emptyAssist(),
    formDraft: emptyFormDraft(),
    /** Local files for create/add-photos; survive paint(); object URLs for the strip. */
    pendingPhotos: [],
    /** Wada picker search + expanded results (Add/Edit; UC-26). */
    wadaSearch: "",
    wadaPickerOpen: false,
    /** Slice B: client nearest-from-photo in flight (draft only). */
    wadaProposing: false,
    suggest: {
      context: "",
      looks: null,
      engine: "",
      suggestionId: "",
      requestedLookCount: 0,
      returnedLookCount: 0,
      lookCountShortfall: false,
    },
    /** Detail opened from a look card — show “Back to looks” (DM-110). */
    detailFromSuggest: false,
  };

  /**
   * DM-107: in-app History entries so Back restores view.
   * Never clear Cognito / call onLogout here — Sign out only.
   */
  let applyingHistory = false;

  function historyUrl() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function navSnapshot() {
    const creating = state.view === "form" && !state.editing;
    const itemId =
      state.editing && (state.view === "detail" || state.view === "form")
        ? state.editing.itemId || null
        : null;
    return {
      dressme: 1,
      view: state.view,
      itemId,
      creating: Boolean(creating),
      fromSuggest: Boolean(
        state.view === "detail" && state.detailFromSuggest
      ),
    };
  }

  function pushNav() {
    if (applyingHistory) return;
    window.history.pushState(navSnapshot(), "", historyUrl());
  }

  function replaceNav() {
    if (applyingHistory) return;
    window.history.replaceState(navSnapshot(), "", historyUrl());
  }

  async function restoreFromHistory(snap) {
    applyingHistory = true;
    try {
      const view = snap.view || "list";
      state.error = "";
      if (view === "suggest") {
        state.view = "suggest";
        state.editing = null;
        state.detailFromSuggest = false;
        state.status = "";
        paint();
      } else if (view === "form" && snap.creating) {
        await openCreate({ skipHistory: true });
      } else if (view === "form" && snap.itemId) {
        const item =
          state.items.find((entry) => entry.itemId === snap.itemId) || {
            itemId: snap.itemId,
          };
        await openEdit(item, { skipHistory: true });
      } else if (view === "detail" && snap.itemId) {
        const item =
          state.items.find((entry) => entry.itemId === snap.itemId) || {
            itemId: snap.itemId,
          };
        await openDetail(item, {
          skipHistory: true,
          fromSuggest: Boolean(snap.fromSuggest),
        });
      } else {
        state.view = "list";
        state.editing = null;
        state.assist = emptyAssist();
        state.formDraft = emptyFormDraft();
        resetWadaPickerUi();
        state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
        updateStatusFromItems();
        paint();
      }
    } finally {
      applyingHistory = false;
    }
    // Re-arm leave-app trap at catalog root (Cognito Hosted UI behind SPA).
    if (state.view === "list") pushNav();
  }

  function onPopState(event) {
    const snap = event.state;
    if (!snap || snap.dressme !== 1) {
      window.history.pushState(navSnapshot(), "", historyUrl());
      return;
    }
    void restoreFromHistory(snap);
  }

  window.addEventListener("popstate", onPopState);

  async function loadAttributeOptions() {
    try {
      const data = await api.listAttributeOptions();
      state.attributeOptions = (data && data.options) || {};
      state.attributeCustom = (data && data.custom) || {};
    } catch {
      // Forms still work as free-text inputs if suggestions fail to load.
      state.attributeOptions = state.attributeOptions || {};
      state.attributeCustom = state.attributeCustom || {};
    }
  }

  function clearAttrHygiene() {
    state.attrChips = {};
    state.attrChipDismissed = {};
  }

  function matchField(key, raw) {
    return matchAttrOption(
      raw,
      state.attributeOptions[key] || [],
      state.attributeCustom[key] || [],
      key
    );
  }

  /** Apply blur hygiene for one field; updates formDraft + chip state. */
  function applyFieldHygiene(key, raw) {
    const result = matchField(key, raw);
    if (!result.normalized && !String(raw || "").trim()) {
      if (state.formDraft) state.formDraft[key] = "";
      delete state.attrChips[key];
      return result;
    }
    if (result.action === "silent" || result.action === "exact") {
      const value = result.suggestion || result.normalized;
      if (!state.formDraft) state.formDraft = {};
      state.formDraft[key] = value;
      delete state.attrChips[key];
      return result;
    }
    if (!state.formDraft) state.formDraft = {};
    state.formDraft[key] = result.normalized;
    if (
      result.action === "chip" &&
      result.suggestion &&
      state.attrChipDismissed[key] !== result.normalized
    ) {
      state.attrChips[key] = { suggestion: result.suggestion };
    } else {
      delete state.attrChips[key];
    }
    return result;
  }

  function useAttrSuggestion(key) {
    const chip = state.attrChips[key];
    if (!chip || !chip.suggestion) return;
    if (!state.formDraft) state.formDraft = {};
    state.formDraft[key] = chip.suggestion;
    delete state.attrChips[key];
    delete state.attrChipDismissed[key];
    paint();
  }

  function keepMineAttr(key) {
    const normalized =
      (state.formDraft && state.formDraft[key]) ||
      normalizeAttrValue(fieldValue(key), key);
    state.attrChipDismissed[key] = normalized;
    delete state.attrChips[key];
    paint();
  }

  function pruneStaleFilters() {
    const options = collectAttributeFilterValues(state.items);
    for (const field of FILTER_FIELDS) {
      const selected = String(state.filters[field.key] || "").trim();
      if (selected && !(options[field.key] || []).includes(selected)) {
        state.filters[field.key] = "";
      }
    }
  }

  function visibleItems() {
    return applyAttributeFilters(state.items, state.filters);
  }

  function itemCountLabel() {
    const total = state.items.length;
    if (!total) return "0 items";
    const visible = visibleItems();
    if (filtersActive(state.filters)) {
      return `${visible.length} of ${total} item${total === 1 ? "" : "s"}`;
    }
    return `${total} item${total === 1 ? "" : "s"}`;
  }

  function updateStatusFromItems() {
    // Item count lives bottom-right on the catalog pane; status is for ops messages.
    state.status = "";
  }

  function activeNavKey() {
    if (state.view === "suggest") return "dressme";
    if (state.view === "form" && !state.editing) return "add";
    return "catalog";
  }

  function navButton(key, label, onClick) {
    const active = activeNavKey() === key;
    return el("button", {
      type: "button",
      className: active ? "" : "secondary",
      text: label,
      "aria-current": active ? "page" : null,
      onClick,
    });
  }

  async function refresh() {
    state.busy = true;
    state.error = "";
    paint();
    try {
      const data = await api.listItems(state.query);
      state.items = data.items || [];
      pruneStaleFilters();
      updateStatusFromItems();
    } catch (err) {
      state.error = err.message || "Could not load catalog.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  function clearFilters() {
    state.filters = emptyFilters();
    updateStatusFromItems();
    paint();
  }

  function addPendingFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(
      (file) => file && String(file.type || "").startsWith("image/")
    );
    if (!incoming.length) return;
    for (const file of incoming) {
      pendingPhotoSeq += 1;
      state.pendingPhotos.push({
        id: `local-${pendingPhotoSeq}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
    paint();
  }

  function removePendingPhoto(id) {
    const next = [];
    for (const entry of state.pendingPhotos) {
      if (entry.id === id) revokePendingPhoto(entry);
      else next.push(entry);
    }
    state.pendingPhotos = next;
    paint();
  }

  function pendingPhotoFiles() {
    return state.pendingPhotos.map((entry) => entry.file);
  }

  function hasAnalyzablePhoto() {
    if (state.pendingPhotos.length) return true;
    if (!state.editing) return false;
    return (state.editing.photos || []).some((photo) => photo.status === "ready");
  }

  async function openCreate(options = {}) {
    const keepPrefill = options && options.keepPrefill;
    const skipHistory = options && options.skipHistory;
    state.view = "form";
    state.editing = null;
    state.assist = emptyAssist();
    clearAttrHygiene();
    resetWadaPickerUi();
    if (!keepPrefill) {
      state.formDraft = emptyFormDraft();
    }
    state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
    state.error = "";
    paint();
    if (!skipHistory) pushNav();
    await loadAttributeOptions();
    if (state.view === "form" && !state.editing) paint();
  }

  async function loadFullItem(itemId) {
    const data = await api.getItem(itemId);
    return data.item;
  }

  async function openEdit(item, options = {}) {
    const skipHistory = options && options.skipHistory;
    state.view = "form";
    state.editing = item;
    state.assist = emptyAssist();
    clearAttrHygiene();
    resetWadaPickerUi();
    state.formDraft = emptyFormDraft();
    state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
    state.error = "";
    state.busy = true;
    paint();
    if (!skipHistory) pushNav();
    try {
      // List payloads use thumbs only; edit needs full-res photo URLs (UC-20).
      const full = await loadFullItem(item.itemId);
      if (state.view === "form") {
        state.editing = full;
      }
      await loadAttributeOptions();
    } catch (err) {
      state.error = err.message || "Could not load item.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function openDetail(item, options = {}) {
    const skipHistory = options && options.skipHistory;
    const fromSuggest = Boolean(options && options.fromSuggest);
    state.view = "detail";
    state.editing = item;
    state.detailFromSuggest = fromSuggest;
    state.error = "";
    state.busy = true;
    paint();
    if (!skipHistory) pushNav();
    try {
      // Overview cards use thumbUrl; detail shows full-resolution photos (UC-20).
      const full = await loadFullItem(item.itemId);
      if (state.view === "detail") {
        state.editing = full;
      }
    } catch (err) {
      state.error = err.message || "Could not load item.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  /**
   * Return to the in-memory suggest session without re-running Bedrock.
   * Prefer History Back when suggest sits under this detail entry.
   */
  function backToLooks() {
    if (state.detailFromSuggest) {
      window.history.back();
      return;
    }
    openSuggest({ skipHistory: true });
  }

  function backToList(options = {}) {
    const skipHistory = options && options.skipHistory;
    const wasList = state.view === "list" && !state.editing;
    state.view = "list";
    state.editing = null;
    state.detailFromSuggest = false;
    state.assist = emptyAssist();
    state.formDraft = emptyFormDraft();
    resetWadaPickerUi();
    state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
    state.error = "";
    updateStatusFromItems();
    paint();
    if (!skipHistory && !wasList) pushNav();
  }

  function fieldValue(key) {
    if (state.formDraft && Object.prototype.hasOwnProperty.call(state.formDraft, key)) {
      return state.formDraft[key] || "";
    }
    if (state.editing) return state.editing[key] || "";
    return "";
  }

  function wadaIdsValue() {
    if (
      state.formDraft &&
      Object.prototype.hasOwnProperty.call(state.formDraft, "wadaColorIds")
    ) {
      return normalizeWadaColorIdsClient(state.formDraft.wadaColorIds);
    }
    if (state.editing) {
      return normalizeWadaColorIdsClient(state.editing.wadaColorIds);
    }
    return [];
  }

  function setWadaIds(ids) {
    if (!state.formDraft) state.formDraft = {};
    state.formDraft.wadaColorIds = normalizeWadaColorIdsClient(ids);
  }

  function resetWadaPickerUi() {
    state.wadaSearch = "";
    state.wadaPickerOpen = false;
  }

  /** Photo URL for client Lab nearest (pending blob first, else first ready thumb). */
  function samplePhotoUrlForWada() {
    if (state.pendingPhotos.length) {
      return state.pendingPhotos[0].url || "";
    }
    if (!state.editing) return "";
    const ready = (state.editing.photos || []).find(
      (photo) => photo && photo.status === "ready"
    );
    if (!ready) return "";
    return ready.thumbUrl || ready.url || "";
  }

  /**
   * Slice B: sample dominant hex → Lab nearest Wada into draft chips.
   * Never writes Dynamo. Empty draft → fill top-1; else no-op unless replace.
   * @returns {Promise<{ applied: boolean, color?: object, reason?: string }>}
   */
  async function proposeWadaFromPhoto({ replace = false } = {}) {
    const url = samplePhotoUrlForWada();
    if (!url) {
      return { applied: false, reason: "no_photo" };
    }
    const current = wadaIdsValue();
    if (current.length && !replace) {
      return { applied: false, reason: "keep_existing" };
    }
    state.wadaProposing = true;
    paint();
    try {
      const sample = await sampleThumb(url);
      if (!sample || !sample.dominantHex) {
        return { applied: false, reason: "sample_failed" };
      }
      const match = nearestWadaColor(sample.dominantHex);
      if (!match) {
        return { applied: false, reason: "no_match" };
      }
      // Top-1 only into draft; Frank edits / Clear / Save as usual.
      setWadaIds([match.id]);
      return { applied: true, color: match };
    } finally {
      state.wadaProposing = false;
    }
  }

  function readFormAttributes(form) {
    const attrs = {};
    for (const field of ATTR_FIELDS) {
      const elField = form.elements[field.key];
      attrs[field.key] = elField ? String(elField.value || "").trim() : "";
    }
    return attrs;
  }

  /** Merge a proposal into the main form draft (empty proposal values keep current). */
  function draftFromProposal(proposal) {
    const attrs = (proposal && proposal.attributes) || {};
    const draft = {};
    for (const field of ATTR_FIELDS) {
      const value = String(attrs[field.key] || "").trim();
      draft[field.key] = value || fieldValue(field.key);
    }
    const proposed = String((proposal && proposal.aiContext) || "").trim();
    draft.aiContext = (proposed || fieldValue("aiContext")).slice(0, 2000);
    // Bedrock does not invent Wada IDs; Slice B fills via client nearest after Appraise.
    draft.wadaColorIds = wadaIdsValue();
    return draft;
  }

  async function runAnalyze(form) {
    const files = pendingPhotoFiles();
    const aiContext = form.elements.aiContext
      ? String(form.elements.aiContext.value || "").trim()
      : fieldValue("aiContext");

    const attributes = readFormAttributes(form);
    // Survive paint() while analyzing.
    state.formDraft = Object.assign({}, attributes, {
      aiContext,
      wadaColorIds: wadaIdsValue(),
    });

    // Send current AI context as hints/answers when present (same durable field).
    const payload = {
      attributes,
      answers: aiContext,
      hints: aiContext,
    };

    state.assist.analyzing = true;
    state.busy = true;
    state.error = "";
    state.status = "Appraising…";
    paint();

    try {
      if (files.length) {
        // MVP: one Bedrock image per click (first file). Extra shots stay for Save.
        if (files.length > 1) {
          state.status = `Appraising first of ${files.length} photos…`;
          paint();
        }
        const compressed = await compressImageFile(files[0]);
        payload.imageBase64 = compressed.imageBase64;
        payload.contentType = compressed.contentType;
      } else if (state.editing && state.editing.itemId) {
        const ready = (state.editing.photos || []).find(
          (photo) => photo.status === "ready"
        );
        if (!ready) {
          throw new Error("Add a photo first (or take one to appraise).");
        }
        payload.itemId = state.editing.itemId;
        payload.photoId = ready.photoId;
      } else {
        throw new Error("Take or add a photo to appraise first.");
      }

      const data = await api.analyzeItemPhoto(payload);
      const proposal = data.proposal || null;
      state.assist.proposal = proposal;
      // Apply directly into the main add/edit fields — no second editable copy.
      if (proposal) {
        state.formDraft = draftFromProposal(proposal);
        state.status =
          "Filled the form from the photo — tweak anything, then Save item.";
      } else {
        state.status = "Appraise returned no proposal. Fill attributes manually.";
      }
      // Slice B: client Lab nearest into empty draft chips only (never auto-save).
      const wadaResult = await proposeWadaFromPhoto({ replace: false });
      if (wadaResult.applied && wadaResult.color) {
        const name = wadaResult.color.name;
        state.status = proposal
          ? `Filled from photo + Wada “${name}” — tweak, then Save.`
          : `Proposed Wada “${name}” from photo — tweak, then Save.`;
      }
    } catch (err) {
      const code = err && err.message ? String(err.message) : "";
      if (
        code === "analyze_unavailable" ||
        code === "bedrock_analyze_failed" ||
        code === "http_502" ||
        code === "http_503"
      ) {
        state.error =
          "Photo appraise is temporarily unavailable. Fill attributes manually or try again.";
      } else {
        state.error = code || "Appraise failed.";
      }
      state.assist.proposal = null;
    } finally {
      state.assist.analyzing = false;
      state.busy = false;
      state.wadaProposing = false;
      paint();
    }
  }

  function openSuggest(options = {}) {
    const skipHistory = options && options.skipHistory;
    state.view = "suggest";
    state.editing = null;
    state.detailFromSuggest = false;
    state.error = "";
    state.status = "";
    paint();
    if (!skipHistory) pushNav();
  }

  async function runSuggest(form) {
    const context = String(form.elements.context.value || "").trim();
    if (!context) {
      state.error = "Context is required.";
      paint();
      return;
    }
    state.suggest.context = context;
    state.busy = true;
    state.error = "";
    state.status = "Assembling looks…";
    paint();
    try {
      const data = await api.suggestOutfits({ context });
      state.suggest.looks = data.looks || [];
      state.suggest.engine = data.engine || "random";
      state.suggest.suggestionId = data.suggestionId || "";
      state.suggest.requestedLookCount = Number(data.requestedLookCount) || 0;
      state.suggest.returnedLookCount =
        Number(data.returnedLookCount) || (data.looks || []).length;
      state.suggest.lookCountShortfall = Boolean(data.lookCountShortfall);
      const n = state.suggest.looks.length;
      state.status =
        (n === 1 ? "1 look" : `${n} looks`) +
        " — pick one mentally. Nothing is recorded in the app.";
    } catch (err) {
      const code = err && err.message ? String(err.message) : "";
      if (code === "suggest_incomplete_looks") {
        state.error =
          "Couldn’t assemble complete looks (one base + bottom, and shoes when you have them — not two shirts). Try again, or add missing pieces.";
      } else if (
        code === "suggest_unavailable" ||
        code === "suggest_invalid_model_json" ||
        code === "suggest_invalid_item_ids" ||
        code === "http_502" ||
        code === "http_503"
      ) {
        state.error =
          "Outfit suggestions are temporarily unavailable. Try again in a moment.";
      } else if (code === "missing_context" || code === "missing_occasion") {
        state.error = "Context is required.";
      } else {
        state.error = code || "Could not suggest outfits.";
      }
      state.suggest.looks = null;
      state.suggest.lookCountShortfall = false;
      state.suggest.requestedLookCount = 0;
      state.suggest.returnedLookCount = 0;
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function saveItem(form) {
    const payload = {};
    // Pre-save hygiene: normalize; silent fold rewrite; undismissed chips = Keep mine.
    for (const field of ATTR_FIELDS) {
      const elField = form.elements[field.key];
      const raw = elField ? String(elField.value || "") : "";
      const result = applyFieldHygiene(field.key, raw);
      if (result.action === "silent" || result.action === "exact") {
        payload[field.key] = result.suggestion || result.normalized;
      } else {
        // Chip ignored on Save → Keep mine (rules 1–4 only; no typo auto-apply).
        payload[field.key] = result.normalized;
      }
      delete state.attrChips[field.key];
    }
    if (form.elements.aiContext) {
      payload.aiContext = String(form.elements.aiContext.value || "").trim();
    }
    payload.wadaColorIds = wadaIdsValue();
    // Keep draft if paint() runs mid-save (busy flag re-render).
    state.formDraft = Object.assign({}, payload);
    const files = pendingPhotoFiles();
    const wasCreate = !state.editing;
    state.busy = true;
    state.error = "";
    state.status = files.length ? "Uploading photos…" : "Saving…";
    paint();
    try {
      if (state.editing) {
        const body = Object.assign({}, payload);
        if (files.length) {
          body.addPhotos = files.map((file) => ({
            contentType: file.type || "image/jpeg",
          }));
        }
        const updated = await api.updateItem(state.editing.itemId, body);
        if (updated.uploads && updated.uploads.length) {
          const photoIds = await api.uploadFiles(updated.uploads, files);
          await api.confirmPhotos(state.editing.itemId, photoIds);
        }
        state.view = "list";
        state.editing = null;
        state.assist = emptyAssist();
        clearAttrHygiene();
        resetWadaPickerUi();
        state.formDraft = emptyFormDraft();
        state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
        state.status = "Saved.";
      } else {
        const created = await api.createItem(
          Object.assign({}, payload, {
            photos: files.map((file) => ({ contentType: file.type || "image/jpeg" })),
          })
        );
        if (created.uploads && created.uploads.length) {
          const photoIds = await api.uploadFiles(created.uploads, files);
          await api.confirmPhotos(created.item.itemId, photoIds);
        }
        // Bulk cataloging: land on another blank Add (no attr carry-over).
        state.editing = null;
        state.assist = emptyAssist();
        clearAttrHygiene();
        resetWadaPickerUi();
        state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
        state.formDraft = emptyFormDraft();
        state.view = "form";
        state.status = "Saved. Add next piece.";
      }
      await loadAttributeOptions();
      // Refresh catalog counts without forcing list view after create.
      try {
        const data = await api.listItems(state.query);
        state.items = data.items || [];
        pruneStaleFilters();
        if (!wasCreate) updateStatusFromItems();
      } catch {
        // Keep the save success path; list refresh can retry from catalog.
      }
      state.busy = false;
      paint();
      replaceNav();
    } catch (err) {
      state.error = err.message || "Save failed.";
      state.busy = false;
      paint();
    }
  }

  async function removeItem(item) {
    const wadaName = primaryWadaName(item);
    const label = wadaName ? `${item.type} (${wadaName})` : item.type;
    if (!window.confirm(`Delete ${label}?`)) return;
    state.busy = true;
    paint();
    try {
      await api.deleteItem(item.itemId);
      state.view = "list";
      state.editing = null;
      state.assist = emptyAssist();
      state.formDraft = emptyFormDraft();
      state.pendingPhotos = clearPendingPhotos(state.pendingPhotos);
      await refresh();
      replaceNav();
    } catch (err) {
      state.error = err.message || "Delete failed.";
      state.busy = false;
      paint();
    }
  }

  async function removePhoto(photoId) {
    if (!state.editing) return;
    if (!window.confirm("Remove this photo from the item?")) return;
    state.busy = true;
    state.error = "";
    state.status = "Removing photo…";
    paint();
    try {
      const updated = await api.updateItem(state.editing.itemId, {
        removePhotoIds: [photoId],
      });
      state.editing = updated.item;
      state.items = state.items.map((item) =>
        item.itemId === updated.item.itemId ? updated.item : item
      );
      state.status = "Photo removed.";
    } catch (err) {
      state.error = err.message || "Could not remove photo.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  /** Move a ready photo to index 0 (catalog overview thumb). Hide control when already first. */
  async function setPrimaryPhoto(photoId) {
    if (!state.editing || state.busy) return;
    const photos = state.editing.photos || [];
    const index = photos.findIndex((entry) => entry.photoId === photoId);
    if (index <= 0) return;
    const photo = photos[index];
    if (!photo || photo.status !== "ready") return;

    const previousPhotos = photos.slice();
    const reordered = photos.slice();
    const [moved] = reordered.splice(index, 1);
    reordered.unshift(moved);

    state.busy = true;
    state.error = "";
    state.status = "Updating catalog photo…";
    state.editing = Object.assign({}, state.editing, { photos: reordered });
    paint();
    try {
      const updated = await api.updateItem(state.editing.itemId, {
        primaryPhotoId: photoId,
      });
      state.editing = updated.item;
      state.items = state.items.map((item) =>
        item.itemId === updated.item.itemId ? updated.item : item
      );
      state.status = "Catalog photo updated.";
    } catch (err) {
      try {
        const fresh = await api.getItem(state.editing.itemId);
        state.editing = fresh.item;
        state.items = state.items.map((item) =>
          item.itemId === fresh.item.itemId ? fresh.item : item
        );
      } catch {
        state.editing = Object.assign({}, state.editing, {
          photos: previousPhotos,
        });
      }
      state.error = err.message || "Could not set catalog photo.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function rotateEditPhoto(photoId) {
    if (!state.editing || state.busy) return;
    const photos = state.editing.photos || [];
    const photo = photos.find((entry) => entry.photoId === photoId);
    if (!photo || photo.status !== "ready" || !photo.url) return;

    const previousUrl = photo.url;
    const previousThumbUrl = photo.thumbUrl;
    let previewUrl = null;

    state.busy = true;
    state.rotatingPhotoId = photoId;
    state.error = "";
    state.status = "Rotating photo…";
    paint();
    try {
      // Instant tile preview (browser canvas), then same-photoId overwrite.
      const rotatedBlob = await rotateImageFromUrl(photo.url);
      previewUrl = URL.createObjectURL(rotatedBlob);
      state.editing = Object.assign({}, state.editing, {
        photos: photos.map((entry) =>
          entry.photoId === photoId
            ? Object.assign({}, entry, {
                url: previewUrl,
                thumbUrl: previewUrl,
              })
            : entry
        ),
      });
      paint();

      const file = new File([rotatedBlob], "rotated.jpg", {
        type: "image/jpeg",
      });
      const updated = await api.updateItem(state.editing.itemId, {
        replacePhotos: [{ photoId, contentType: "image/jpeg" }],
      });
      if (!updated.uploads || !updated.uploads.length) {
        throw new Error("upload_slot_missing");
      }
      const photoIds = await api.uploadFiles(updated.uploads, [file]);
      const confirmed = await api.confirmPhotos(
        state.editing.itemId,
        photoIds
      );
      state.editing = confirmed.item;
      state.items = state.items.map((item) =>
        item.itemId === confirmed.item.itemId ? confirmed.item : item
      );
      state.status = "Photo rotated.";
    } catch (err) {
      // Prefer server truth (replace may have partially landed); else revert preview.
      try {
        const fresh = await api.getItem(state.editing.itemId);
        state.editing = fresh.item;
        state.items = state.items.map((item) =>
          item.itemId === fresh.item.itemId ? fresh.item : item
        );
      } catch {
        if (state.editing && state.editing.photos) {
          state.editing = Object.assign({}, state.editing, {
            photos: state.editing.photos.map((entry) =>
              entry.photoId === photoId
                ? Object.assign({}, entry, {
                    url: previousUrl,
                    thumbUrl: previousThumbUrl,
                  })
                : entry
            ),
          });
        }
      }
      if (err && err.message === "image_cors_failed") {
        state.error =
          "Could not read photo for rotate (media CORS). Try again, or hard-refresh.";
      } else if (err && /^(Load failed|Failed to fetch)$/i.test(err.message)) {
        state.error =
          "Could not read photo for rotate (media CORS). Try again, or hard-refresh.";
      } else {
        state.error = err.message || "Could not rotate photo.";
      }
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      state.busy = false;
      state.rotatingPhotoId = null;
      paint();
    }
  }

  function paint() {
    root.replaceChildren();
    const shell = el("main", { className: "shell stack" });

    const top = el("div", { className: "topbar" }, [
      el("nav", { className: "topbar-actions", "aria-label": "Primary" }, [
        navButton("catalog", "Catalog", backToList),
        navButton("add", "Add item", () => openCreate()),
        navButton("dressme", "DressMe", openSuggest),
      ]),
    ]);
    shell.append(top);

    if (state.error) {
      shell.append(el("p", { className: "status error", role: "status", text: state.error }));
    } else if (state.status) {
      shell.append(el("p", { className: "status", role: "status", text: state.status }));
    }

    if (state.view === "list") {
      shell.append(renderList());
    } else if (state.view === "form") {
      shell.append(renderForm());
    } else if (state.view === "detail" && state.editing) {
      shell.append(renderDetail(state.editing));
    } else if (state.view === "suggest") {
      shell.append(renderSuggest());
    }

    shell.append(
      el("div", { className: "page-footer" }, [
        el("p", { className: "meta" }, [
          el("a", { href: "/imprint.html", text: "Imprint" }),
        ]),
        el("button", {
          type: "button",
          className: "secondary sign-out",
          text: "Sign out",
          onClick: onLogout,
        }),
      ])
    );
    root.append(shell);
  }

  function renderFilters() {
    const activeCount = FILTER_FIELDS.filter((field) =>
      String(state.filters[field.key] || "").trim()
    ).length;
    const open = state.filtersOpen;
    const toggleLabel = open
      ? "Hide filters"
      : activeCount
        ? `Filters (${activeCount})`
        : "Filters";

    const fold = el("div", { className: "filter-fold" });
    fold.append(
      el("button", {
        type: "button",
        className: "secondary filter-fold-toggle",
        text: toggleLabel,
        "aria-expanded": open ? "true" : "false",
        "aria-controls": "catalog-filters",
        onClick: () => {
          state.filtersOpen = !state.filtersOpen;
          writeFiltersOpen(state.filtersOpen);
          paint();
        },
      })
    );

    if (!open) return fold;

    const options = collectAttributeFilterValues(state.items);
    const bar = el("div", {
      id: "catalog-filters",
      className: "filter-bar",
      role: "group",
      "aria-label": "Filter catalog by attributes",
    });
    const grid = el("div", { className: "filter-grid" });
    for (const field of FILTER_FIELDS) {
      const values = options[field.key] || [];
      const select = el("select", {
        name: `filter-${field.key}`,
        "aria-label": `Filter by ${field.label}`,
        disabled: state.busy || !state.items.length ? "disabled" : null,
        onChange: (event) => {
          state.filters[field.key] = event.target.value;
          updateStatusFromItems();
          paint();
        },
      });
      select.append(
        el("option", {
          value: "",
          text: `Any ${field.label.toLowerCase()}`,
        })
      );
      for (const value of values) {
        select.append(el("option", { value, text: value }));
      }
      select.value = state.filters[field.key] || "";
      grid.append(
        el("label", { className: "filter-field" }, [
          el("span", { className: "field-title", text: field.label }),
          select,
        ])
      );
    }
    bar.append(grid);
    const actions = el("div", { className: "row filter-actions" }, [
      el("button", {
        type: "button",
        className: "secondary",
        text: "Clear filters",
        disabled:
          state.busy || !filtersActive(state.filters) ? "disabled" : null,
        onClick: clearFilters,
      }),
    ]);
    bar.append(actions);
    fold.append(bar);
    return fold;
  }

  function renderList() {
    const panel = el("section", { className: "panel stack" });
    const searchRow = el("div", { className: "row" }, [
      el("input", {
        className: "search",
        type: "search",
        name: "q",
        placeholder: "Search type, brand, Wada…",
        value: state.query,
        onInput: (event) => {
          state.query = event.target.value;
        },
        onKeydown: (event) => {
          if (event.key === "Enter") refresh();
        },
      }),
      el("button", {
        type: "button",
        className: "secondary",
        text: "Search",
        disabled: state.busy ? "disabled" : null,
        onClick: refresh,
      }),
    ]);
    panel.append(searchRow);
    panel.append(renderFilters());

    const visible = visibleItems();
    const grid = el("div", { className: "catalog-grid" });
    if (!state.items.length) {
      grid.append(
        el("p", {
          className: "muted",
          text: "Your catalog is empty. Capture a piece with photos and attributes.",
        })
      );
    } else if (!visible.length) {
      grid.append(
        el("p", {
          className: "muted",
          text: "No items match these filters. Clear filters to see everything again.",
        })
      );
    } else {
      for (const item of visible) {
        const url = thumbUrl(item);
        const card = el(
          "button",
          {
            type: "button",
            className: "item-card",
            onClick: () => openDetail(item),
          },
          [
            url
              ? el("img", {
                  src: url,
                  alt: (() => {
                    const wadaName = primaryWadaName(item);
                    return wadaName ? `${item.type} ${wadaName}` : item.type;
                  })(),
                })
              : el("div", { className: "thumb", text: "No photo" }),
            el("div", { className: "meta" }, [
              el("p", { className: "title", text: item.type }),
              el("div", { className: "sub-row" }, [
                el("p", {
                  className: "sub",
                  text: catalogCardSubLine(item),
                }),
                wadaPrimarySwatch(item.wadaColorIds),
              ]),
            ]),
          ]
        );
        grid.append(card);
      }
    }
    panel.append(grid);
    panel.append(
      el("p", {
        className: "catalog-count",
        role: "status",
        text: itemCountLabel(),
      })
    );
    return panel;
  }

  function analyzeButtonLabel() {
    if (state.assist.analyzing) return "Appraising…";
    if (state.assist.proposal) return "Re-appraise";
    return "Appraise";
  }

  function syncAiContextDraft(value) {
    const next = String(value || "").slice(0, 2000);
    if (state.formDraft) {
      state.formDraft.aiContext = next;
    } else {
      state.formDraft = { aiContext: next };
    }
  }

  async function onProposeWadaFromPhoto({ replace }) {
    if (state.busy || state.wadaProposing) return;
    state.error = "";
    const result = await proposeWadaFromPhoto({ replace: !!replace });
    if (result.applied && result.color) {
      state.status = replace
        ? `Replaced Wada with “${result.color.name}” from photo — tweak, then Save.`
        : `Proposed Wada “${result.color.name}” from photo — tweak, then Save.`;
    } else if (result.reason === "sample_failed" || result.reason === "no_match") {
      state.error =
        "Could not sample a colour from this photo. Pick a Wada colour manually.";
    } else if (result.reason === "no_photo") {
      state.error = "Add a photo first to propose a Wada colour.";
    }
    paint();
  }

  function renderWadaField() {
    const selected = wadaIdsValue();
    const atMax = selected.length >= MAX_WADA_COLORS;
    const canSample = Boolean(samplePhotoUrlForWada());
    const results = state.wadaPickerOpen
      ? searchWadaColors(state.wadaSearch, { excludeIds: selected }).slice(0, 40)
      : [];

    const chips = el("div", {
      className: "wada-chips",
      role: "list",
      "aria-label": "Selected Wada colours",
    });
    if (selected.length) {
      selected.forEach((id, index) => {
        const color = getWadaColor(id);
        if (!color) return;
        const chip = el(
          "div",
          {
            className: "wada-chip",
            role: "listitem",
          },
          [
            el("span", {
              className: "wada-chip-swatch",
              style: `background:${color.hex}`,
              "aria-hidden": "true",
            }),
            el("span", {
              className: "wada-chip-name",
              text: index === 0 ? `${color.name} (primary)` : color.name,
            }),
            index > 0
              ? el("button", {
                  type: "button",
                  className: "secondary wada-chip-primary",
                  text: "Primary",
                  disabled: state.busy || state.wadaProposing ? "disabled" : null,
                  "aria-label": `Make ${color.name} primary`,
                  onClick: () => {
                    const next = [id, ...selected.filter((x) => x !== id)];
                    setWadaIds(next);
                    paint();
                  },
                })
              : null,
            el("button", {
              type: "button",
              className: "secondary wada-chip-remove",
              text: "Remove",
              disabled: state.busy || state.wadaProposing ? "disabled" : null,
              "aria-label": `Remove ${color.name}`,
              onClick: () => {
                setWadaIds(selected.filter((x) => x !== id));
                paint();
              },
            }),
          ]
        );
        chips.append(chip);
      });
    }

    const search = el("input", {
      type: "search",
      className: "wada-search",
      name: "wadaSearch",
      placeholder: "Search Wada colour…",
      value: state.wadaSearch,
      autocomplete: "off",
      disabled: state.busy || state.wadaProposing || atMax ? "disabled" : null,
      onFocus: () => {
        if (!state.wadaPickerOpen) {
          state.wadaPickerOpen = true;
          paint();
          const again = document.querySelector("input.wada-search");
          if (again) again.focus();
        }
      },
      onInput: (event) => {
        const start = event.target.selectionStart;
        const end = event.target.selectionEnd;
        state.wadaSearch = String(event.target.value || "");
        state.wadaPickerOpen = true;
        paint();
        const again = document.querySelector("input.wada-search");
        if (again) {
          again.focus();
          try {
            again.setSelectionRange(start, end);
          } catch {
            /* some browsers reject selection on type=search */
          }
        }
      },
    });

    const resultList = el("div", {
      className: "wada-results",
      role: "listbox",
      "aria-label": "Wada colour matches",
    });
    if (state.wadaPickerOpen) {
      if (!results.length) {
        resultList.append(
          el("p", {
            className: "muted",
            text: atMax
              ? `At most ${MAX_WADA_COLORS} Wada colours.`
              : "No matches.",
          })
        );
      } else {
        for (const color of results) {
          resultList.append(
            el(
              "button",
              {
                type: "button",
                className: "wada-result",
                role: "option",
                disabled:
                  state.busy || state.wadaProposing || atMax ? "disabled" : null,
                onClick: () => {
                  if (atMax) return;
                  setWadaIds([...selected, color.id]);
                  state.wadaSearch = "";
                  paint();
                },
              },
              [
                el("span", {
                  className: "wada-result-swatch",
                  style: `background:${color.hex}`,
                  "aria-hidden": "true",
                }),
                el("span", { className: "wada-result-name", text: color.name }),
              ]
            )
          );
        }
      }
    }

    const fromPhotoLabel = state.wadaProposing
      ? "Sampling…"
      : selected.length
        ? "Replace from photo"
        : "From photo";
    const fromPhotoBtn = el("button", {
      type: "button",
      className: "secondary wada-from-photo",
      text: fromPhotoLabel,
      disabled:
        state.busy || state.wadaProposing || !canSample ? "disabled" : null,
      "aria-label": selected.length
        ? "Replace Wada colours from photo sample"
        : "Propose Wada colour from photo sample",
      onClick: () => onProposeWadaFromPhoto({ replace: selected.length > 0 }),
    });

    return el("div", { className: "wada-field stack" }, [
      el("div", { className: "wada-field-head" }, [
        el("span", { className: "field-title", text: "Wada reference" }),
        el("div", { className: "wada-field-actions" }, [
          fromPhotoBtn,
          el("button", {
            type: "button",
            className: "secondary wada-clear",
            text: "Clear",
            disabled:
              state.busy || state.wadaProposing || !selected.length
                ? "disabled"
                : null,
            "aria-label": "Clear Wada colours",
            onClick: () => {
              setWadaIds([]);
              resetWadaPickerUi();
              paint();
            },
          }),
        ]),
      ]),
      chips,
      search,
      state.wadaPickerOpen ? resultList : null,
      state.wadaPickerOpen
        ? el("button", {
            type: "button",
            className: "secondary wada-collapse",
            text: "Hide palette",
            onClick: () => {
              state.wadaPickerOpen = false;
              paint();
            },
          })
        : el("button", {
            type: "button",
            className: "secondary wada-expand",
            text: atMax ? "Palette full" : "Browse palette",
            disabled: state.busy || state.wadaProposing || atMax ? "disabled" : null,
            onClick: () => {
              state.wadaPickerOpen = true;
              paint();
            },
          }),
    ]);
  }

  function renderAiContextField() {
    const initial = fieldValue("aiContext");
    const textarea = el("textarea", {
      name: "aiContext",
      rows: "3",
      maxlength: "2000",
      placeholder: "When you wear it, pairing notes…",
      text: initial,
      onInput: (event) => syncAiContextDraft(event.target.value),
    });
    // textContent seeds defaultValue; set .value so Save always reads the draft.
    textarea.value = initial;
    return el("div", { className: "stack ai-context-field" }, [
      el("span", { className: "field-title", text: "AI context" }),
      textarea,
    ]);
  }

  function renderAssistPanel(form) {
    const proposal = state.assist.proposal;
    const canAnalyze = hasAnalyzablePhoto();
    const block = el("div", { className: "assist-panel stack" }, [
      renderAiContextField(),
      el("div", { className: "row assist-early-actions" }, [
        el("button", {
          type: "button",
          className: canAnalyze ? "" : "secondary",
          text: analyzeButtonLabel(),
          disabled:
            state.busy || state.assist.analyzing || !canAnalyze
              ? "disabled"
              : null,
          onClick: () => runAnalyze(form),
        }),
      ]),
    ]);

    if (state.assist.analyzing) {
      block.append(
        el("p", {
          className: "assist-progress",
          role: "status",
          text: state.status || "Appraising…",
        })
      );
    }

    if (!proposal) {
      return block;
    }

    // Short read-only summary only — attrs + aiContext live in the form fields.
    block.append(
      el("p", {
        className: "assist-label",
        text: `Filled from photo: ${proposal.label || "item"}`,
      })
    );
    if (proposal.notes) {
      block.append(el("p", { className: "muted", text: proposal.notes }));
    }

    const questions = proposal.followUpQuestions || [];
    if (questions.length) {
      const qList = el("ul", { className: "assist-questions" });
      for (const q of questions) {
        qList.append(el("li", { text: q }));
      }
      block.append(
        el("p", { className: "field-label", text: "Follow-up ideas" })
      );
      block.append(qList);
    }
    return block;
  }

  function renderPendingPhotoStrip() {
    if (!state.pendingPhotos.length) return null;
    const strip = el("div", {
      className: "pending-photo-strip",
      role: "list",
      "aria-label": "Photos to upload",
    });
    for (const entry of state.pendingPhotos) {
      strip.append(
        el(
          "div",
          {
            className: "pending-photo",
            role: "listitem",
            "data-pending-id": entry.id,
          },
          [
            el("img", {
              src: entry.url,
              alt: "Shot ready to upload",
            }),
            el("button", {
              type: "button",
              className: "secondary pending-photo-remove",
              text: "×",
              "aria-label": "Remove this shot",
              disabled: state.busy ? "disabled" : null,
              onClick: () => removePendingPhoto(entry.id),
            }),
          ]
        )
      );
    }
    return strip;
  }

  function renderPhotoCaptureBlock() {
    const editing = state.editing;
    // Camera-intent capture (iPhone Safari rear camera). Separate library input —
    // combining capture+multiple is unreliable on iOS; we accumulate shots in state.
    const cameraInput = el("input", {
      className: "hidden",
      type: "file",
      accept: "image/*",
      capture: "environment",
      "aria-hidden": "true",
      tabindex: "-1",
      onChange: (event) => {
        addPendingFiles(event.target.files);
        event.target.value = "";
      },
    });
    const libraryInput = el("input", {
      className: "hidden",
      type: "file",
      accept: "image/*",
      multiple: "multiple",
      "aria-hidden": "true",
      tabindex: "-1",
      onChange: (event) => {
        addPendingFiles(event.target.files);
        event.target.value = "";
      },
    });

    const block = el("div", { className: "stack photo-capture" }, [
      el("p", {
        className: "field-label",
        text: editing ? "Add photos" : "Photos",
      }),
      el("div", { className: "row photo-capture-actions" }, [
        el("button", {
          type: "button",
          text: "Take photo",
          disabled: state.busy ? "disabled" : null,
          onClick: () => cameraInput.click(),
        }),
        el("button", {
          type: "button",
          className: "secondary",
          text: "From library",
          disabled: state.busy ? "disabled" : null,
          onClick: () => libraryInput.click(),
        }),
      ]),
      cameraInput,
      libraryInput,
    ]);

    const strip = renderPendingPhotoStrip();
    if (strip) block.append(strip);
    return block;
  }

  function renderFormStickyActions(editing) {
    const bar = el("div", {
      className: "form-sticky-actions",
      role: "group",
      "aria-label": "Save item",
    });
    bar.append(
      el("button", {
        type: "submit",
        text:
          state.busy && !state.assist.analyzing
            ? "Saving…"
            : editing
              ? "Save item"
              : "Save & add next",
        disabled: state.busy ? "disabled" : null,
      })
    );
    if (editing) {
      bar.append(
        el("button", {
          type: "button",
          className: "danger",
          text: "Delete",
          disabled: state.busy ? "disabled" : null,
          onClick: () => removeItem(editing),
        })
      );
    }
    return bar;
  }

  function renderForm() {
    const editing = state.editing;
    const panel = el("section", { className: "panel stack form-panel" });

    const form = el("form", {
      className: "stack item-form",
      onSubmit: (event) => {
        event.preventDefault();
        saveItem(event.target);
      },
    });

    if (editing) {
      const existing = editing.photos || [];
      const photoBlock = el("div", { className: "stack current-photos" }, [
        el("p", { className: "field-label", text: "Current photos" }),
      ]);
      if (!existing.length) {
        photoBlock.append(
          el("p", {
            className: "muted",
            text: "No photos yet.",
          })
        );
      } else {
        const gridPhotos = el("div", { className: "edit-photos" });
        for (const photo of existing) {
          const rotating = state.rotatingPhotoId === photo.photoId;
          const tile = el("div", {
            className: rotating ? "edit-photo is-rotating" : "edit-photo",
            "data-photo-id": photo.photoId,
          });
          const media = el("div", { className: "edit-photo-media" });
          if (photo.url) {
            // Full-res URL on edit (UC-20); click opens lightbox (UC-23).
            media.append(
              photoOpenButton(photo.url, `${editing.type || "item"} photo`)
            );
          } else {
            media.append(
              el("div", {
                className: "thumb",
                text: photo.status === "pending" ? "Pending" : "No preview",
              })
            );
          }
          // Ready photos only — durable rotate / primary after S3 complete (not Add pending).
          if (photo.status === "ready" && photo.url) {
            // Hide star when already photos[0]; catalog overview uses first photo.
            if (existing[0] && existing[0].photoId !== photo.photoId) {
              media.append(
                el(
                  "button",
                  {
                    type: "button",
                    className: "photo-primary",
                    disabled: state.busy ? "disabled" : null,
                    "aria-label": "Use as catalog photo",
                    title: "Use as catalog photo",
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPrimaryPhoto(photo.photoId);
                    },
                  },
                  [primaryStarIcon()]
                )
              );
            }
            media.append(
              el(
                "button",
                {
                  type: "button",
                  className: "photo-rotate",
                  disabled: state.busy ? "disabled" : null,
                  "aria-label": "Rotate photo 90 degrees clockwise",
                  title: "Rotate 90° clockwise",
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    rotateEditPhoto(photo.photoId);
                  },
                },
                [rotateArrowIcon()]
              )
            );
          }
          tile.append(media);
          tile.append(
            el("button", {
              type: "button",
              className: "secondary photo-remove",
              text: "Remove",
              disabled: state.busy ? "disabled" : null,
              "aria-label": "Remove photo",
              onClick: () => removePhoto(photo.photoId),
            })
          );
          gridPhotos.append(tile);
        }
        photoBlock.append(gridPhotos);
      }
      form.append(photoBlock);
    }

    form.append(renderPhotoCaptureBlock());
    form.append(renderAssistPanel(form));

    const grid = el("div", { className: "form-grid" });
    for (const field of ATTR_FIELDS) {
      const useSuggestions = SUGGESTION_KEYS.has(field.key);
      const listId = useSuggestions ? `suggest-${field.key}` : null;
      const fieldKey = field.key;
      const input = el("input", {
        name: field.key,
        required: "required",
        placeholder: useSuggestions
          ? `${field.placeholder} — pick or type`
          : field.placeholder,
        value: fieldValue(field.key),
        autocomplete: useSuggestions ? "off" : null,
        list: listId,
        onBlur: (event) => {
          applyFieldHygiene(fieldKey, event.target.value);
          // Defer paint so chip Use/Keep mine clicks fire on the existing DOM.
          setTimeout(() => {
            if (state.view === "form") paint();
          }, 0);
        },
      });
      // Explicit title node keeps row baselines stable (UC-21) across wrapping labels.
      const children = [
        el("span", { className: "field-title", text: field.label }),
        input,
      ];
      if (useSuggestions) {
        const options = state.attributeOptions[field.key] || [];
        const datalist = el("datalist", { id: listId });
        for (const value of options) {
          datalist.append(el("option", { value }));
        }
        children.push(datalist);
      }
      const chip = state.attrChips[field.key];
      if (chip && chip.suggestion) {
        children.push(
          el("div", {
            className: "attr-hygiene-chip",
            role: "status",
          }, [
            el("span", {
              className: "attr-hygiene-prompt",
              text: `Did you mean “${chip.suggestion}”?`,
            }),
            el("span", { className: "attr-hygiene-actions" }, [
              el("button", {
                type: "button",
                className: "attr-hygiene-use",
                text: "Use",
                onClick: () => useAttrSuggestion(fieldKey),
              }),
              el("button", {
                type: "button",
                className: "secondary attr-hygiene-keep",
                text: "Keep mine",
                onClick: () => keepMineAttr(fieldKey),
              }),
            ]),
          ])
        );
      }
      grid.append(el("label", {}, children));
    }
    form.append(grid);
    form.append(renderWadaField());
    form.append(renderFormStickyActions(editing));
    panel.append(form);
    return panel;
  }

  function renderDetail(item) {
    const attrParts = [
      primaryWadaName(item),
      item.fabric,
      item.formality,
      item.season,
      item.brandModel || "—",
      item.outfitRole,
      item.pattern,
    ].filter((part) => String(part || "").trim());
    const panel = el("section", { className: "panel stack" }, [
      state.detailFromSuggest
        ? el("div", { className: "row detail-back-looks" }, [
            el("button", {
              type: "button",
              className: "secondary",
              text: "Back to looks",
              onClick: backToLooks,
            }),
          ])
        : null,
      el("h1", { text: item.type }),
      el("div", { className: "lede-row" }, [
        el("p", {
          className: "lede",
          text: attrParts.join(" · "),
        }),
        wadaPrimarySwatch(item.wadaColorIds),
      ]),
      item.aiContext
        ? el("p", {
            className: "ai-context",
            text: item.aiContext,
          })
        : null,
    ]);

    const photos = el("div", { className: "detail-photos" });
    // Detail always uses full-res `url` from GET /items/{id} (not thumbUrl).
    const ready = (item.photos || []).filter((p) => p.url);
    if (!ready.length) {
      photos.append(el("p", { className: "muted", text: "No photos yet." }));
    } else {
      for (const photo of ready) {
        photos.append(photoOpenButton(photo.url, item.type));
      }
    }
    panel.append(photos);
    const entryDate = formatEntryDate(item.createdAt);
    panel.append(
      el("div", { className: "row detail-actions" }, [
        el("div", { className: "row" }, [
          el("button", {
            type: "button",
            text: "Edit",
            onClick: () => openEdit(item),
          }),
          el("button", {
            type: "button",
            className: "danger",
            text: "Delete",
            onClick: () => removeItem(item),
          }),
        ]),
        entryDate
          ? el("p", {
              className: "muted detail-entry-date",
              text: `Entry date ${entryDate}`,
            })
          : null,
      ])
    );
    return panel;
  }

  function renderSuggest() {
    const panel = el("section", { className: "panel stack suggest-panel" });

    const form = el("form", {
      className: "stack suggest-form",
      onSubmit: (event) => {
        event.preventDefault();
        runSuggest(event.target);
      },
    });
    form.append(
      el("label", {}, [
        el("span", { className: "field-title", text: "Context" }),
        el("input", {
          name: "context",
          required: "required",
          maxlength: "480",
          placeholder: "e.g. client lunch, cool and dry — or ‘5 looks please’",
          value: state.suggest.context || "",
          autocomplete: "off",
        }),
      ])
    );
    form.append(
      el("div", { className: "row" }, [
        el("button", {
          type: "submit",
          text: state.busy
            ? "Working…"
            : state.suggest.looks
              ? "Suggest again"
              : "Dress me",
          disabled: state.busy ? "disabled" : null,
        }),
      ])
    );
    panel.append(form);

    if (state.suggest.looks) {
      const results = el("div", {
        className: "looks-grid",
        "aria-live": "polite",
      });
      if (state.suggest.engine) {
        results.append(
          el("p", {
            className: "muted suggest-engine",
            text:
              state.suggest.engine === "bedrock"
                ? "AI suggestions from your catalog"
                : state.suggest.engine === "random"
                  ? "Random assembly from your catalog."
                  : `Engine: ${state.suggest.engine}`,
          })
        );
      }
      if (
        state.suggest.lookCountShortfall &&
        state.suggest.requestedLookCount > 0
      ) {
        const requested = state.suggest.requestedLookCount;
        const returned =
          state.suggest.returnedLookCount || state.suggest.looks.length;
        results.append(
          el("p", {
            className: "muted suggest-shortfall",
            role: "status",
            text: `Could assemble ${returned} of ${requested} complete looks from your closet.`,
          })
        );
      }
      state.suggest.looks.forEach((look, index) => {
        results.append(
          renderLookCard(look, index, {
            onItemOpen: (piece) => openDetail(piece, { fromSuggest: true }),
          })
        );
      });
      panel.append(results);
    } else if (!state.items.length) {
      panel.append(
        el("p", {
          className: "muted",
          text: "Your catalog is empty — add a few pieces first so looks have photos to show.",
        })
      );
    }

    return panel;
  }

  // Seed History + one buffer entry so the first Back does not hit Cognito.
  replaceNav();
  pushNav();
  refresh();
  return { refresh };
}
