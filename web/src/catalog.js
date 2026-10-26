import * as api from "./api.js";

const ATTR_FIELDS = [
  { key: "type", label: "Type", placeholder: "jacket, shirt, shoes…" },
  { key: "color", label: "Color", placeholder: "navy" },
  { key: "fabric", label: "Fabric", placeholder: "wool" },
  { key: "brandModel", label: "Brand / model", placeholder: "optional detail" },
  { key: "formality", label: "Formality", placeholder: "business, casual…" },
  { key: "pattern", label: "Pattern", placeholder: "solid, stripe…" },
  { key: "season", label: "Season / climate", placeholder: "all-season" },
  { key: "outfitRole", label: "Outfit role", placeholder: "outerwear, base…" },
];

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
  const photo = (item.photos || []).find((p) => p.url);
  return photo ? photo.url : "";
}

export function renderCatalogApp(root, { onLogout }) {
  const state = {
    items: [],
    query: "",
    view: "list", // list | form | detail
    editing: null,
    status: "",
    error: "",
    busy: false,
  };

  async function refresh() {
    state.busy = true;
    state.error = "";
    paint();
    try {
      const data = await api.listItems(state.query);
      state.items = data.items || [];
      state.status = state.items.length
        ? `${state.items.length} item${state.items.length === 1 ? "" : "s"}`
        : "No items yet — add your first piece.";
    } catch (err) {
      state.error = err.message || "Could not load catalog.";
    } finally {
      state.busy = false;
      paint();
    }
  }

  function openCreate() {
    state.view = "form";
    state.editing = null;
    state.error = "";
    paint();
  }

  function openEdit(item) {
    state.view = "form";
    state.editing = item;
    state.error = "";
    paint();
  }

  function openDetail(item) {
    state.view = "detail";
    state.editing = item;
    state.error = "";
    paint();
  }

  function backToList() {
    state.view = "list";
    state.editing = null;
    state.error = "";
    paint();
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

  function paint() {
    root.replaceChildren();
    const shell = el("main", { className: "shell stack" });

    const top = el("div", { className: "topbar" }, [
      el("div", {}, [
        el("p", { className: "brand", text: "DressMe" }),
        el("p", { className: "muted", text: "Wardrobe catalog" }),
      ]),
      el("div", { className: "topbar-actions" }, [
        state.view === "list"
          ? el("button", { type: "button", text: "Add item", onClick: openCreate })
          : el("button", {
              type: "button",
              className: "secondary",
              text: "Back",
              onClick: backToList,
            }),
        el("button", {
          type: "button",
          className: "secondary",
          text: "Sign out",
          onClick: onLogout,
        }),
      ]),
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
    }

    shell.append(
      el("p", { className: "meta" }, [el("a", { href: "/imprint.html", text: "Imprint" })])
    );
    root.append(shell);
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

    const grid = el("div", { className: "catalog-grid" });
    if (!state.items.length) {
      grid.append(
        el("p", {
          className: "muted",
          text: "Your catalog is empty. Capture a piece with photos and attributes.",
        })
      );
    } else {
      for (const item of state.items) {
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
              ? el("img", { src: url, alt: `${item.type} ${item.color}` })
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
      grid.append(
        el("label", {}, [
          field.label,
          el("input", {
            name: field.key,
            required: "required",
            placeholder: field.placeholder,
            value: editing ? editing[field.key] || "" : "",
          }),
        ])
      );
    }
    form.append(grid);
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
    const ready = (item.photos || []).filter((p) => p.url);
    if (!ready.length) {
      photos.append(el("p", { className: "muted", text: "No photos yet." }));
    } else {
      for (const photo of ready) {
        photos.append(el("img", { src: photo.url, alt: item.type }));
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

  refresh();
  return { refresh };
}
