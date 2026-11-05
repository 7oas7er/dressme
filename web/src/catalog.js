import * as api from "./api.js";
import { layerImageUrl } from "./lookLayout.js";
import { renderLookCard } from "./lookCard.js";

/** Fields that use suggested values + free text (UC-19), including brand/model. */
const SUGGESTION_KEYS = new Set([
  "type",
  "color",
  "fabric",
  "brandModel",
  "formality",
  "pattern",
  "season",
  "outfitRole",
]);

const ATTR_FIELDS = [
  { key: "type", label: "Type", placeholder: "jacket, shirt, shoes…" },
  { key: "color", label: "Color", placeholder: "navy" },
  { key: "fabric", label: "Fabric", placeholder: "wool" },
  { key: "brandModel", label: "Brand / model", placeholder: "maker or model" },
  { key: "formality", label: "Formality", placeholder: "business, casual…" },
  { key: "pattern", label: "Pattern", placeholder: "solid, stripe…" },
  { key: "season", label: "Season / climate", placeholder: "all-season" },
  { key: "outfitRole", label: "Outfit role", placeholder: "outerwear, base…" },
];

/** Unique non-empty attribute values present in the wardrobe (UC-07). */
export function collectAttributeFilterValues(items) {
  const out = {};
  for (const field of ATTR_FIELDS) {
    const seen = new Set();
    for (const item of items || []) {
      const value = String(item[field.key] || "").trim();
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
    for (const field of ATTR_FIELDS) {
      const selected = String(active[field.key] || "").trim();
      if (!selected) continue;
      if (String(item[field.key] || "").trim() !== selected) return false;
    }
    return true;
  });
}

function filtersActive(filters) {
  return ATTR_FIELDS.some((field) => String((filters || {})[field.key] || "").trim());
}

function emptyFilters() {
  const next = {};
  for (const field of ATTR_FIELDS) next[field.key] = "";
  return next;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
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
  // B2 / §4.3: catalog prefers cutout when present; else UC-20 thumb / full.
  return layerImageUrl(item, { purpose: "catalog" });
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

export function renderCatalogApp(root, { onLogout }) {
  const state = {
    items: [],
    query: "",
    filters: emptyFilters(),
    view: "list", // list | form | detail | suggest
    editing: null,
    status: "",
    error: "",
    busy: false,
    attributeOptions: {},
    suggest: {
      occasion: "",
      weather: "",
      looks: null,
      engine: "",
      suggestionId: "",
    },
  };

  async function loadAttributeOptions() {
    try {
      const data = await api.listAttributeOptions();
      state.attributeOptions = (data && data.options) || {};
    } catch {
      // Forms still work as free-text inputs if suggestions fail to load.
      state.attributeOptions = state.attributeOptions || {};
    }
  }

  function pruneStaleFilters() {
    const options = collectAttributeFilterValues(state.items);
    for (const field of ATTR_FIELDS) {
      const selected = String(state.filters[field.key] || "").trim();
      if (selected && !(options[field.key] || []).includes(selected)) {
        state.filters[field.key] = "";
      }
    }
  }

  function visibleItems() {
    return applyAttributeFilters(state.items, state.filters);
  }

  function updateStatusFromItems() {
    const total = state.items.length;
    if (!total) {
      state.status = "No items yet — add your first piece.";
      return;
    }
    const visible = visibleItems();
    if (filtersActive(state.filters)) {
      state.status =
        visible.length === 0
          ? "No items match these filters."
          : `${visible.length} of ${total} item${total === 1 ? "" : "s"}`;
      return;
    }
    state.status = `${total} item${total === 1 ? "" : "s"}`;
  }

  let cutoutBackfillStarted = false;
  /** Must match infra/lambda/cutouts.js CUTOUT_VERSION after each matte bump. */
  const CUTOUT_ALGO_CLIENT = 3;
  const CUTOUT_ALGO_STORAGE_KEY = "dressme.cutoutAlgo";

  async function maybeBackfillCutouts() {
    if (cutoutBackfillStarted) return;
    const needsMissing = (state.items || []).some((item) =>
      (item.photos || []).some(
        (photo) => photo && photo.status === "ready" && !photo.cutoutUrl
      )
    );
    let storedAlgo = null;
    try {
      storedAlgo = localStorage.getItem(CUTOUT_ALGO_STORAGE_KEY);
    } catch {
      storedAlgo = null;
    }
    const needsUpgrade = storedAlgo !== String(CUTOUT_ALGO_CLIENT);
    if (!needsMissing && !needsUpgrade) return;
    cutoutBackfillStarted = true;
    try {
      state.status = needsUpgrade
        ? "Refreshing cutouts…"
        : "Generating cutouts for existing photos…";
      paint();
      const result = await api.backfillCutouts({
        force: needsUpgrade,
        upgrade: needsUpgrade,
      });
      const processed = (result && result.processed) || 0;
      const serverVersion = (result && result.cutoutVersion) || 0;
      if (processed > 0) {
        const data = await api.listItems(state.query);
        state.items = data.items || [];
        pruneStaleFilters();
      }
      // Only pin the client algo marker once the deployed Lambda speaks this version
      // (avoids marking "done" before stg terraform apply ships CUTOUT_VERSION).
      if (serverVersion === CUTOUT_ALGO_CLIENT) {
        try {
          localStorage.setItem(
            CUTOUT_ALGO_STORAGE_KEY,
            String(CUTOUT_ALGO_CLIENT)
          );
        } catch {
          /* ignore quota / private mode */
        }
      }
      updateStatusFromItems();
      if (processed > 0) {
        state.status =
          (state.status ? state.status + " · " : "") +
          `Cutouts ready (${processed}).`;
      }
    } catch (err) {
      // Non-fatal: catalog still works with photographic thumbs.
      console.warn("cutout_backfill_failed", err);
      updateStatusFromItems();
    } finally {
      paint();
    }
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
      maybeBackfillCutouts();
    }
  }

  function clearFilters() {
    state.filters = emptyFilters();
    updateStatusFromItems();
    paint();
  }

  async function openCreate() {
    state.view = "form";
    state.editing = null;
    state.error = "";
    paint();
    await loadAttributeOptions();
    if (state.view === "form" && !state.editing) paint();
  }

  async function loadFullItem(itemId) {
    const data = await api.getItem(itemId);
    return data.item;
  }

  async function openEdit(item) {
    state.view = "form";
    state.editing = item;
    state.error = "";
    state.busy = true;
    paint();
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

  async function openDetail(item) {
    state.view = "detail";
    state.editing = item;
    state.error = "";
    state.busy = true;
    paint();
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

  function backToList() {
    state.view = "list";
    state.editing = null;
    state.error = "";
    updateStatusFromItems();
    paint();
  }

  function openSuggest() {
    state.view = "suggest";
    state.editing = null;
    state.error = "";
    state.status =
      "Enter an occasion (and optional weather). You’ll get three looks from your catalog.";
    paint();
  }

  async function runSuggest(form) {
    const occasion = String(form.elements.occasion.value || "").trim();
    const weather = String(form.elements.weather.value || "").trim();
    if (!occasion) {
      state.error = "Occasion is required.";
      paint();
      return;
    }
    state.suggest.occasion = occasion;
    state.suggest.weather = weather;
    state.busy = true;
    state.error = "";
    state.status = "Assembling three looks…";
    paint();
    try {
      const data = await api.suggestOutfits({ occasion, weather });
      state.suggest.looks = data.looks || [];
      state.suggest.engine = data.engine || "random";
      state.suggest.suggestionId = data.suggestionId || "";
      state.status =
        "Three looks — pick one mentally. Nothing is recorded in the app.";
    } catch (err) {
      state.error = err.message || "Could not suggest outfits.";
      state.suggest.looks = null;
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function saveItem(form) {
    const payload = {};
    for (const field of ATTR_FIELDS) {
      payload[field.key] = form.elements[field.key].value.trim();
    }
    const fileInput = form.elements.photos;
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
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
      }
      state.view = "list";
      state.editing = null;
      state.status = "Saved.";
      await loadAttributeOptions();
      await refresh();
    } catch (err) {
      state.error = err.message || "Save failed.";
      state.busy = false;
      paint();
    }
  }

  async function removeItem(item) {
    if (!window.confirm(`Delete ${item.type} (${item.color})?`)) return;
    state.busy = true;
    paint();
    try {
      await api.deleteItem(item.itemId);
      state.view = "list";
      state.editing = null;
      await refresh();
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

  function paint() {
    root.replaceChildren();
    const shell = el("main", { className: "shell stack" });

    const topActions = [];
    if (state.view === "list") {
      topActions.push(
        el("button", {
          type: "button",
          text: "Suggest outfits",
          onClick: openSuggest,
        })
      );
      topActions.push(
        el("button", {
          type: "button",
          className: "secondary",
          text: "Add item",
          onClick: openCreate,
        })
      );
    } else {
      topActions.push(
        el("button", {
          type: "button",
          className: "secondary",
          text: "Back to catalog",
          onClick: backToList,
        })
      );
    }
    topActions.push(
      el("button", {
        type: "button",
        className: "secondary",
        text: "Sign out",
        onClick: onLogout,
      })
    );

    const top = el("div", { className: "topbar" }, [
      el("div", {}, [
        el("p", { className: "brand", text: "DressMe" }),
        el("p", {
          className: "muted",
          text:
            state.view === "suggest"
              ? "Dress me — three looks"
              : "Wardrobe catalog",
        }),
      ]),
      el("div", { className: "topbar-actions" }, topActions),
    ]);
    shell.append(top);

    if (state.error) {
      shell.append(el("p", { className: "status error", role: "status", text: state.error }));
    } else {
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
      el("p", { className: "meta" }, [el("a", { href: "/imprint.html", text: "Imprint" })])
    );
    root.append(shell);
  }

  function renderFilters() {
    const options = collectAttributeFilterValues(state.items);
    const bar = el("div", {
      className: "filter-bar",
      role: "group",
      "aria-label": "Filter catalog by attributes",
    });
    const grid = el("div", { className: "filter-grid" });
    for (const field of ATTR_FIELDS) {
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
    return bar;
  }

  function renderList() {
    const panel = el("section", { className: "panel stack" });
    const searchRow = el("div", { className: "row" }, [
      el("input", {
        className: "search",
        type: "search",
        name: "q",
        placeholder: "Search color, type, brand…",
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
        const hasCutout = (item.photos || []).some((p) => p && p.cutoutUrl);
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
                  alt: `${item.type} ${item.color}`,
                  className: hasCutout ? "catalog-cutout" : null,
                })
              : el("div", { className: "thumb", text: "No photo" }),
            el("div", { className: "meta" }, [
              el("p", { className: "title", text: item.type }),
              el("p", {
                className: "sub",
                text: `${item.color} · ${item.outfitRole}`,
              }),
            ]),
          ]
        );
        grid.append(card);
      }
    }
    panel.append(grid);
    return panel;
  }

  function renderForm() {
    const editing = state.editing;
    const panel = el("section", { className: "panel stack" }, [
      el("h1", {
        text: editing ? "Edit item" : "Add item",
      }),
      el("p", {
        className: "lede",
        text: "Photos + attributes — aim for about three minutes per piece.",
      }),
    ]);

    const form = el("form", {
      className: "stack",
      onSubmit: (event) => {
        event.preventDefault();
        saveItem(event.target);
      },
    });

    const grid = el("div", { className: "form-grid" });
    for (const field of ATTR_FIELDS) {
      const useSuggestions = SUGGESTION_KEYS.has(field.key);
      const listId = useSuggestions ? `suggest-${field.key}` : null;
      const input = el("input", {
        name: field.key,
        required: "required",
        placeholder: useSuggestions
          ? `${field.placeholder} — pick or type`
          : field.placeholder,
        value: editing ? editing[field.key] || "" : "",
        autocomplete: useSuggestions ? "off" : null,
        list: listId,
        "aria-describedby": useSuggestions ? `hint-${field.key}` : null,
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
        children.push(
          el("span", {
            id: `hint-${field.key}`,
            className: "field-hint",
            text: "Suggested values — or type your own.",
          })
        );
      }
      grid.append(el("label", {}, children));
    }
    form.append(grid);

    if (editing) {
      const existing = editing.photos || [];
      const photoBlock = el("div", { className: "stack current-photos" }, [
        el("p", { className: "field-label", text: "Current photos" }),
      ]);
      if (!existing.length) {
        photoBlock.append(
          el("p", {
            className: "muted",
            text: "No photos on this item yet. Add some below.",
          })
        );
      } else {
        const gridPhotos = el("div", { className: "edit-photos" });
        for (const photo of existing) {
          const tile = el("div", {
            className: "edit-photo",
            "data-photo-id": photo.photoId,
          });
          if (photo.url) {
            // Full-res URL on edit (UC-20); click opens lightbox (UC-23).
            tile.append(
              photoOpenButton(photo.url, `${editing.type || "item"} photo`)
            );
          } else {
            tile.append(
              el("div", {
                className: "thumb",
                text: photo.status === "pending" ? "Pending" : "No preview",
              })
            );
          }
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

    form.append(
      el("label", {}, [
        editing ? "Add photos" : "Photos",
        el("input", {
          name: "photos",
          type: "file",
          accept: "image/*",
          capture: "environment",
          multiple: "multiple",
        }),
      ])
    );
    form.append(
      el("div", { className: "row" }, [
        el("button", {
          type: "submit",
          text: state.busy ? "Saving…" : "Save item",
          disabled: state.busy ? "disabled" : null,
        }),
        editing
          ? el("button", {
              type: "button",
              className: "danger",
              text: "Delete",
              disabled: state.busy ? "disabled" : null,
              onClick: () => removeItem(editing),
            })
          : null,
      ])
    );
    panel.append(form);
    return panel;
  }

  function renderDetail(item) {
    const panel = el("section", { className: "panel stack" }, [
      el("h1", { text: item.type }),
      el("p", {
        className: "lede",
        text: `${item.color} · ${item.fabric} · ${item.formality} · ${item.season}`,
      }),
      el("p", {
        className: "muted",
        text: `${item.brandModel || "—"} · role: ${item.outfitRole} · pattern: ${item.pattern}`,
      }),
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
    panel.append(
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
      ])
    );
    return panel;
  }

  function renderSuggest() {
    const panel = el("section", { className: "panel stack suggest-panel" }, [
      el("h1", { text: "Suggest outfits" }),
      el("p", {
        className: "lede",
        text: "Occasion plus optional weather → exactly three looks from your wardrobe. Pick offline; the app does not record worn, like, or reject.",
      }),
    ]);

    const form = el("form", {
      className: "stack suggest-form",
      onSubmit: (event) => {
        event.preventDefault();
        runSuggest(event.target);
      },
    });
    form.append(
      el("label", {}, [
        el("span", { className: "field-title", text: "Occasion" }),
        el("input", {
          name: "occasion",
          required: "required",
          maxlength: "240",
          placeholder: "e.g. client lunch, weekend market, evening drinks",
          value: state.suggest.occasion || "",
          autocomplete: "off",
        }),
      ])
    );
    form.append(
      el("label", {}, [
        el("span", { className: "field-title", text: "Weather (optional)" }),
        el("input", {
          name: "weather",
          maxlength: "240",
          placeholder: "e.g. cool and dry, warm evening",
          value: state.suggest.weather || "",
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
              state.suggest.engine === "random"
                ? "Random assembly from your catalog (AI suggestions come later)."
                : `Engine: ${state.suggest.engine}`,
          })
        );
      }
      state.suggest.looks.forEach((look, index) => {
        results.append(renderLookCard(look, index));
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

  refresh();
  return { refresh };
}
