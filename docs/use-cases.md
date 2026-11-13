# DressMe Use Cases

Derived from the frozen Product Canvas (Project store).

**Status:** Locked — Must list is the **v1 scope contract** (confirmed 2026-10-25; amended 2026-10-26 for UC-18, UC-19; amended 2026-11-05 for UC-07, UC-20–23; amended 2026-11-06 for UC-05 Option D + UC-24 demoted; amended 2026-11-07 for UC-25 add-time AI assist + UC-04 Bedrock text suggest / UC-09 rationale in the same slice; amended 2026-11-09 for UC-26–28 Sanzo Wada color reference; amended 2026-11-09 for UC-05 photos-only look cards + Wada plate; amended 2026-11-09 drop free-text color; Later amended 2026-11-13 for UC-32–33 shopping support; Later amended 2026-11-13 for UC-34 look feedback; Later amended 2026-11-13 for post-MVP version bundling locked; Later amended 2026-11-13 for UC-35–36; Later amended 2026-11-13 for UC-37).  
Last updated: 2026-11-13 (Europe/Berlin; Later UC-37 parked)

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

### Post-MVP version bundling (locked)

Locked 2026-11-13. Post-MVP work ships in these version buckets (not one mega-release):

1. **v1.1 — Trust & polish:** ponytail Phase C + UC-29/30 (group/sort + Insights/attr audit) + UC-31 history
2. **v1.2 — Learning Suggest:** UC-34 feedback (+ maybe UC-14)
3. **v1.3 — Shopping:** UC-32 then UC-33 (+ UC-12 if useful)
4. **Later still:** UC-13/08/15, UC-28 full scoring, UC-16/17, UC-24, UC-35, UC-36, UC-37

### UC-28 — Wada combination-aware suggest
As Frank, when I request outfit suggestions, DressMe may use published Sanzo Wada *combinations* from *A Dictionary of Color Combinations* as a soft harmony prior when scoring or ranking looks — without forcing every outfit onto a book combination. **v1-lite:** Suggest system prompt includes a compact soft combo prior (MIT vendor data); primary Wada names already feed Bedrock text (UC-04), capture/catalog/detail swatch, and look-card plates (UC-05). **Forced combo scoring / ranking stays Later.**

### UC-24 — Catalog cutouts (not required)
Previously: transparent cutout derivatives on upload for catalog + hero. **Not required** for Option D — generation stopped; existing `*.cutout.webp` / Dynamo keys left in place. May revisit later for AI categorization, not as a hero/catalog product must.

### UC-08 — Dedicated “re-run with tweaked inputs” flow
Beyond simply starting UC-04 again with new context text.

### UC-10 — Travel packing optimization
Suggest a minimal multi-day packing list from the wardrobe.

### UC-11 — Wardrobe gap / “what’s missing” shopping advice
Recommend purchases that would fill gaps. **Acceptance-flavored backlog:** see **UC-32**.

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

### UC-32 — Shopping advice from catalog gaps
As Frank, I can ask DressMe what to buy next — e.g. “recommend shoes I’m missing”, “what coat next”, “shirt I lack” — and get purchase suggestions grounded in **catalog gaps** and **complementarity** with what I already own (classic menswear roles/slots), not generic fashion trends. Each suggestion names the gap (type / role / formality / season as relevant) and why filling it would unlock more outfits; it must **not** invent pieces I already have. Free-text ask or a light “what’s missing” entry is enough; no full shopping catalog integration in this slice. Elaborates the UC-11 stub. **Later / post-MVP.**

### UC-33 — Candidate piece try-on with closet
As Frank, when considering a purchase (in a shop or on a web shop), I share a **photo of a candidate piece**; DressMe generates outfit looks that **pair that candidate with existing wardrobe items** (photos-only look cards in the spirit of UC-05 where practical) so I can judge fit and complementarity before buying. The candidate is **not** added to the catalog unless I later run UC-01. Distinct from UC-12 (near-duplicate / “too close to what I own” warning). **Later / post-MVP.**

### UC-34 — Look feedback (rating + notes)
As Frank, after a Suggest run (UC-04 / UC-05), I can rate each generated look with a **1–5 star** score and optional **free-text** note. DressMe stores that feedback and the Suggest engine uses it to **personalize future recommendations** (prefer what I like, avoid what I reject). Distinct from UC-06 (no in-app feedback in v1) and UC-14 (worn / like / reject + wear history). **Later / post-MVP.**

### UC-35 — Mobile web / iPhone experience (assess + improve)
As Frank, primary use is **iPhone Safari / mobile web** (not a native app). At some point assess and pursue **non-native** improvements so the SPA works better on iPhone — e.g. PWA / home-screen installability, viewport and safe-area handling, touch targets, and mobile Safari quirks. Explicitly **not** a native iOS rewrite (distinct from UC-17). **Later / post-MVP.**

### UC-36 — Visual look-and-feel refresh
As Frank, the current UI is functional and fine for now. Later, revisit styling for a more **unique DressMe look** — explore directions; this is not a redesign commitment in the current release. **Later / post-MVP.**

### UC-37 — Lean GuardDuty account threat detection
As Frank (operator), enable **Amazon GuardDuty** for early warning on account compromise and S3/API abuse — lean setup only, not a SIEM. **Acceptance:** detectors on in **`eu-north-1`** and **`us-east-1`** (foundational); **S3 Protection on** in `eu-north-1` (media/site buckets); **Lambda Protection**, **Runtime Monitoring**, **Malware Protection**, and **AI Protection off** unless a later spend note says otherwise; strip any AWS auto-enabled extras the same day; **EventBridge → SNS email** on GuardDuty findings with severity **HIGH/CRITICAL** (GuardDuty-only phase — no Security Hub required for this UC). Confirm healthy detector status and Cost Explorer `AmazonGuardDuty` under an agreed cap after a normal deploy week. Shared-account blast radius; written spend approval vs the €10 ceiling before enable. **Out of scope for this UC:** Security Hub, AWS Config, multi-framework CSPM (Hub is a separate Phase 2 / sibling Later follow-on). No Terraform enablement in the concept phase. **Later / post-MVP.**
