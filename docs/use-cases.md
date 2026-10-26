# DressMe Use Cases

Derived from the frozen Product Canvas (Project store).

**Status:** Locked — Must list is the **v1 scope contract** (confirmed 2026-10-25; amended 2026-10-26 for UC-18, UC-19).  
Last updated: 2026-10-26 (Europe/Berlin)

---

## Must — v1 scope contract

### UC-01 — Add a wardrobe item
As Frank, when I acquire a new piece, I capture photos and attributes (type, color, fabric, brand/model, formality, pattern, season/climate, outfit role) in about 3 minutes, so it appears in my catalog.

### UC-02 — Browse and look up the catalog
As Frank, I browse/search my items (with photos) so I can see what I own — including opening the app while shopping for a quick visual check (no gap analysis, no near-duplicate detection).

### UC-03 — Edit or remove a wardrobe item
As Frank, I update attributes/photos or delete an item so the catalog stays accurate.

### UC-18 — Manage photos while editing an item
As Frank, when I open Edit item, I see the item’s current photos and can remove any of them (and still add new ones), so the catalog visuals stay accurate without deleting the whole item.

### UC-19 — Suggested values with free-text for item attributes
As Frank, when I add or edit an item, for fields such as fabric, outfit role, type, color, formality, pattern, and season/climate I can pick from a dropdown of suggested values, or enter free text if none match; a new free-text value is remembered and appears in that field’s dropdown going forward.

### UC-04 — Request outfit suggestions
As Frank, before getting dressed, I enter a free-text occasion and (when relevant) manual weather, then receive exactly three outfit suggestions drawn only from my catalog, informed by classic menswear knowledge.

### UC-05 — View a look as a flat-lay collage
As Frank, for each of the three suggestions I see a collage/flat-lay of the actual item photos so I can judge the look visually.

### UC-06 — Pick among three looks (no in-app feedback)
As Frank, I choose which look to wear mentally / offline; the app does not record worn, like, or reject in v1.

---

## Later — out of v1 scope

Includes former “Should” candidates not pulled into the v1 contract.

### UC-07 — Filter or group catalog by type / formality / season
Narrow the catalog (e.g. jackets, black-tie suitable, summer).

### UC-08 — Dedicated “re-run with tweaked inputs” flow
Beyond simply starting UC-04 again with new occasion/weather text.

### UC-09 — Short rationale per look
Brief “why this works” copy for each suggestion (supports the on-rules success signal; not required in v1 UI).

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
