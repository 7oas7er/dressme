# DressMe Use Cases

Derived from the frozen Product Canvas (Project store).

**Status:** Locked — Must list is the **v1 scope contract** (confirmed 2026-10-25; amended 2026-10-26 for UC-18, UC-19; amended 2026-11-05 for UC-07, UC-20–23; amended 2026-11-06 for UC-05 Option D + UC-24 demoted; amended 2026-11-07 for UC-25 add-time AI assist + UC-04 Bedrock text suggest / UC-09 rationale in the same slice; amended 2026-11-09 for UC-26–28 Sanzo Wada color reference; amended 2026-11-09 for UC-05 photos-only look cards + Wada plate; amended 2026-11-09 drop free-text color).  
Last updated: 2026-11-09 (Europe/Berlin; free-text `color` removed — Wada-only)

Synced from Project store use cases where they diverge; Must list below is authoritative for this repo.

---

## Must — v1 scope contract

### UC-01 — Add a wardrobe item
As Frank, when I acquire a new piece, I capture photos and attributes (type, Wada reference palette, fabric, brand/model, formality, pattern, season/climate, outfit role) in about 3 minutes, so it appears in my catalog. Optional add-time AI assist (UC-25) may propose attributes and a short context note; Frank always reviews/edits before save (including confirming or changing Wada picks — UC-26). On phone (esp. iPhone Safari), add is camera-first with multi-shot + strip remove, **Appraise** once near the photos/AI context (as soon as a photo exists; no typing required), **Save** sticky above the safe area, and a successful save lands on a blank **Add next** form (no attribute carry-over from the previous item, including brand/model). Top chrome is **Catalog** / **Add item** / **DressMe** (active white-on-blue); Sign out sits on the footer row with Imprint (right side); item count is bottom-right on the catalog pane.

### UC-25 — Add-time AI catalog assist
As Frank, when I add or edit an item, I can run **Appraise** so the server (Bedrock multimodal via `/api/items/analyze`) proposes type/attrs, a short **aiContext** for later outfit suggest, and optional follow-up questions; I edit and confirm before anything is saved. One analyze call per click; never auto-commit invented facts. After Appraise (and via **From photo** / **Replace from photo**), the SPA may propose a nearest Wada reference from a client photo sample (UC-26 / Slice B) — not part of the Bedrock JSON. The **AI context** field is a normal textarea — use OS / iOS keyboard dictation when speaking is easier; there is no in-app Mic / Web Speech control.

### UC-26 — Assign or edit Wada reference color(s)
As Frank, when I add or edit an item, I assign **1–N Sanzo Wada reference colors** (stable IDs, English display names, hex/HSL; max 4) via picker/search of Wada names — this is the **only** color attribute. I can multi-swatch, clear (“No Wada” / empty list), and set primary (first); I confirm before save. After Appraise (or **From photo**), the client may propose the Lab-nearest Wada into empty draft chips; **Replace from photo** overwrites chips only when I tap it — never auto-save.

### UC-02 — Browse and look up the catalog
As Frank, I browse/search my items (with photos) so I can see what I own — including opening the app while shopping for a quick visual check (no gap analysis, no near-duplicate detection). Each catalog card shows **type** as the title and a sub line of **`Brand · color`** (primary Wada English name when `wadaColorIds[0]` resolves; omit the color segment when unset; color alone when brand is empty — no outfit role on the card). Beside that sub line (to the right), a small filled circle shows the primary Wada color when set (UC-27). Opening an item shows its **entry date** (when it was added to the catalog) in the detail footer beside Edit / Delete.

### UC-27 — Catalog / detail true-color swatch
As Frank, on each catalog card and on item detail (beside the attribute line, to the right), I see a **filled circle** of the item’s primary Wada reference color when one is set, so true color is visible even when the phone photo is wrong. Catalog cards keep a small circle; detail uses a larger (2×) circle. Detail shows all attributes as one `·`-separated line above the AI context paragraph (no “AI context” label on the read-only pane).

### UC-03 — Edit or remove a wardrobe item
As Frank, I update attributes/photos (including Wada reference palette via UC-26) or delete an item so the catalog stays accurate.

### UC-18 — Manage photos while editing an item
As Frank, when I open Edit item, I see the item’s current photos and can remove any of them (and still add new ones), so the catalog visuals stay accurate without deleting the whole item. On each ready photo I can tap a lower-right rotate control to turn it 90° clockwise; the browser rotates the image immediately, then DressMe overwrites that photo’s stored JPEG (same photo id) and regenerates the thumbnail on complete so catalog, detail, and suggest strip stay upright. Each ready photo that is not already first also shows a top-right star control; tapping it moves that photo to the front of the item’s photo list so the catalog overview (and other “first photo” surfaces) show it. New uploads append and do not auto-become first; there is no drag-reorder.

### UC-19 — Suggested values with free-text for item attributes
As Frank, when I add or edit an item, for fields such as fabric, outfit role, type, formality, pattern, season/climate, **and brand/model** I can pick from a dropdown of suggested values, or enter free text if none match; a new free-text value is remembered and appears in that field’s dropdown going forward. **Wada reference colors** use the dedicated Wada picker/search (UC-26), not this free-text suggest list. On blur (and again before Save), DressMe normalizes punctuation/delimiters and may silently rewrite casing to a known option, or show a compact **Did you mean…?** chip (delimiter near-match or Levenshtein-1 typo, especially brands) with **Use** / **Keep mine** — Keep mine preserves free text liberty; Lambda re-applies the same normalize rules on create/update.

### UC-20 — Fast catalog thumbnails
As Frank, when I open the catalog overview, item photos load quickly via a low-resolution thumbnail for each picture; full-resolution images remain available when I open or edit an item. New uploads generate a thumbnail automatically; existing items get thumbnails so the overview stays fast without re-uploading.

### UC-23 — Larger photos on item detail with click-to-enlarge
As Frank, when I open an item, its photos are shown larger than the catalog thumbnails so I can judge the piece clearly; clicking a photo opens an even larger view (lightbox) that I can dismiss.

### UC-21 — Brand/model field alignment
As Frank, on the add/edit item form, the Brand/model control sits on the same baseline as the other fields in its row (not shifted lower).

### UC-07 — Filter the catalog by attributes
As Frank, above the catalog grid (below search) I can expand a foldable filter pane (folded by default; open/closed remembered for the browser tab) and filter items by attribute categories that matter while browsing (at least type, **Wada color** (English name), fabric, formality, pattern, season/climate, outfit role, and brand/model), using the values present in my wardrobe; filters combine (AND), and I can clear them to see everything again.

### UC-04 — Request outfit suggestions
As Frank, before getting dressed, I enter a free-text **context** (event, weather, or anything else that matters) — and may ask how many looks I want in that same prompt — then receive that many outfit suggestions (default **3**, clamped **1–8**) drawn only from my catalog via Bedrock text suggest (attrs + `aiContext` + primary Wada English name/ID when set; no photos), informed by a DressMe style pack (layering, waist finish, weather/function). When the closet cannot support N complete looks, DressMe returns what it can and notes the shortfall. Colour on catalog rows is Wada-only. Suggest model is env-pinned (`SUGGEST_MODEL_ID`; stg may trial Sonnet while Appraise stays Haiku). `SUGGEST_ENGINE=random` remains available as a Terraform rollback (random assembly ignores Wada).

### UC-05 — View a look as photos + Wada plate
As Frank, for each suggestion I see one outfit card: a short **Look N** header with an optional catchy AI **title**, an optional **Wada combination plate** built from each piece’s primary Wada only (equal-width colour blocks + English names; skip pieces with no Wada; omit the pane when none resolve; no free-text colour fallback), and a row of **enlarged photographic thumbs** of the pieces. Tapping a piece opens **item Detail**; browser **Back** and an explicit **“Back to looks”** control return me to the **same** set of looks without re-running suggest. Option D SVG mannequin hero is **retired for v1 UI** (modules kept for a Later fresh hero). Looks must ship with **mandatory core** filled (base + bottom + footwear when the closet has shoes); cold/outdoor contexts prefer a layer when available; looped trousers get a belt or suspenders when supported (side-adjusters exempt). Other accessories stay optional. A shortfall banner appears when fewer than requested complete looks could be assembled.

### UC-06 — Pick among looks (no in-app feedback)
As Frank, I choose which look to wear mentally / offline; the app does not record worn, like, or reject in v1.

### UC-09 — Short rationale per look
As Frank, under each look card I see a short Bedrock rationale (1–3 sentences) explaining why the pieces fit this context — glance composition first, then why. Empty rationales (e.g. random engine) omit the element.

---

## Later — out of v1 scope

Includes former “Should” candidates not pulled into the v1 contract.

### UC-28 — Wada combination-aware suggest
As Frank, when I request outfit suggestions, DressMe may use published Sanzo Wada *combinations* from *A Dictionary of Color Combinations* as a soft harmony prior when scoring or ranking looks — without forcing every outfit onto a book combination. **v1-lite:** Suggest system prompt includes a compact soft combo prior (MIT vendor data); primary Wada names already feed Bedrock text (UC-04), capture/catalog/detail swatch, and look-card plates (UC-05). **Forced combo scoring / ranking stays Later.**

### UC-24 — Catalog cutouts (not required)
Previously: transparent cutout derivatives on upload for catalog + hero. **Not required** for Option D — generation stopped; existing `*.cutout.webp` / Dynamo keys left in place. May revisit later for AI categorization, not as a hero/catalog product must.

### UC-08 — Dedicated “re-run with tweaked inputs” flow
Beyond simply starting UC-04 again with new context text.

### UC-10 — Travel packing optimization
Suggest a minimal multi-day packing list from the wardrobe.

### UC-11 — Wardrobe gap / “what’s missing” shopping advice
Recommend purchases that would fill gaps.

### UC-12 — Near-duplicate / “too close to what I own” shopping check
Warn when a potential purchase is too similar to an existing item.

### UC-13 — Lock or swap a piece and restyle
Keep selected items fixed and regenerate the rest of the outfit.

### UC-14 — Mark worn / like / reject; wear history
Feed variety and later ratings from usage.

### UC-15 — Automatic weather
Infer weather from location/date instead of manual entry.

### UC-16 — Multi-user accounts and publishing flows
Other users, onboarding, monetization.

### UC-17 — Native mobile app
Beyond web (phone browser OK for v1).
