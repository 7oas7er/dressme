# Suggest modules

- `core.js` — constants, slots, formality, Bedrock client deps
- `brief.js` — look-count / occasion / packing parse
- `copy.js` — title/rationale rewrite + sync
- `repair.js` — slot uniqueness, waist/belt, packing, completeness
- `assemble.js` — random + Bedrock assemble; soft catalog cap (240) + request-aware formality/role subset
- `http.js` — `suggestLooks` handler + enrich/cap meta (`catalogCapped`)

Facade: `../suggest.js` re-exports the prior public API for tests and `api.js`.
