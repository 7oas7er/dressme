import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSuggestExportPayload,
  collagePhotoUrl,
  exportItemForSuggest,
  lookHeadline,
  lookSummary,
  stringifySuggestExport,
  suggestExportFilename,
} from "../../web/src/suggest.js";
import { suggestOutfits } from "../../web/src/api.js";

test("collagePhotoUrl prefers full-res over thumb", () => {
  assert.equal(
    collagePhotoUrl({
      photos: [{ thumbUrl: "https://t.example/a.jpg", url: "https://f.example/a.jpg" }],
    }),
    "https://f.example/a.jpg"
  );
  assert.equal(
    collagePhotoUrl({ photos: [{ thumbUrl: "https://t.example/a.jpg" }] }),
    "https://t.example/a.jpg"
  );
  assert.equal(collagePhotoUrl({ photos: [] }), "");
});

test("look helpers summarize pieces without feedback UI", () => {
  assert.equal(lookHeadline({ lookId: "2" }, 0), "Look 2");
  assert.equal(lookHeadline({ lookId: "5" }, 4), "Look 5");
  assert.equal(
    lookHeadline({ lookId: "2", title: "Soft Navy Stack" }, 0),
    "Look 2 · Soft Navy Stack"
  );
  assert.equal(
    lookHeadline({ lookId: "1", title: "  " }, 0),
    "Look 1"
  );
  assert.equal(
    lookSummary({
      items: [
        {
          outfitRole: "outerwear",
          type: "blazer",
          wadaColorIds: ["wada:v1:0"],
        },
        { outfitRole: "shirt", type: "oxford", wadaColorIds: [] },
      ],
    }),
    "Hermosa Pink outerwear · shirt"
  );
  assert.match(lookSummary({ items: [] }), /No pieces/);
});

test("exportItemForSuggest keeps attrs and Wada, drops photo URLs", () => {
  const exported = exportItemForSuggest({
    itemId: "i1",
    type: "blazer",
    brandModel: "Drake's Donegal",
    fabric: "wool",
    formality: "smart",
    pattern: "solid",
    season: "all-season",
    outfitRole: "outerwear",
    aiContext: "Navy Donegal; soft shoulder.",
    wadaColorIds: ["wada:v1:0"],
    photos: [
      {
        photoId: "p1",
        url: "https://signed.example/full.jpg",
        thumbUrl: "https://signed.example/thumb.jpg",
      },
    ],
  });
  assert.equal(exported.itemId, "i1");
  assert.equal(exported.brandModel, "Drake's Donegal");
  assert.equal(exported.aiContext, "Navy Donegal; soft shoulder.");
  assert.deepEqual(exported.photoIds, ["p1"]);
  assert.equal(exported.wada.length, 1);
  assert.equal(exported.wada[0].id, "wada:v1:0");
  assert.ok(exported.wada[0].name);
  assert.match(exported.wada[0].hex, /^#/);
  assert.equal(exported.url, undefined);
  assert.equal(exported.photos, undefined);
});

test("buildSuggestExportPayload shapes session for hillclimb paste", () => {
  const payload = buildSuggestExportPayload(
    {
      context: "client lunch, cool and dry — 2 looks please",
      engine: "bedrock",
      modelId: "anthropic.claude-sonnet-4-6",
      suggestionId: "sid-1",
      requestedLookCount: 2,
      returnedLookCount: 2,
      looks: [
        {
          lookId: "1",
          title: "Soft Navy Stack",
          rationale: "Navy Donegal over a white oxford keeps lunch sharp.",
          items: [
            {
              itemId: "a",
              type: "blazer",
              outfitRole: "outerwear",
              wadaColorIds: ["wada:v1:0"],
              photos: [{ photoId: "pa", url: "https://x/a.jpg" }],
            },
            {
              itemId: "b",
              type: "shirt",
              outfitRole: "base",
              brandModel: "Eterna",
            },
          ],
        },
      ],
    },
    { now: () => new Date("2026-11-11T12:00:00.000Z") }
  );
  assert.equal(payload.exportedAt, "2026-11-11T12:00:00.000Z");
  assert.equal(payload.context, "client lunch, cool and dry — 2 looks please");
  assert.equal(payload.lookCount, 1);
  assert.equal(payload.requestedLookCount, 2);
  assert.equal(payload.engine, "bedrock");
  assert.equal(payload.modelId, "anthropic.claude-sonnet-4-6");
  assert.equal(payload.looks[0].title, "Soft Navy Stack");
  assert.deepEqual(payload.looks[0].itemIds, ["a", "b"]);
  assert.equal(payload.looks[0].items[0].photoIds[0], "pa");
  assert.match(stringifySuggestExport(payload), /"Soft Navy Stack"/);
  assert.match(
    suggestExportFilename(payload.exportedAt),
    /^dressme-suggest-20261111-120000Z\.json$/
  );
});

test("suggestOutfits posts context and dual-writes occasion for deploy window", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          engine: "bedrock",
          context: "opera tonight, rainy",
          looks: [],
          suggestionId: "sid",
        });
      },
    };
  };
  try {
    const data = await suggestOutfits({ context: "opera tonight, rainy" });
    assert.equal(data.engine, "bedrock");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/suggest");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.context, "opera tonight, rainy");
    // Dual-write: live Lambda may still require occasion until TF apply.
    assert.equal(body.occasion, "opera tonight, rainy");
    assert.equal(body.weather, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
