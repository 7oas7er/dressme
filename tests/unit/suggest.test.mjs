import assert from "node:assert/strict";
import test from "node:test";
import { collagePhotoUrl, lookHeadline, lookSummary } from "../../web/src/suggest.js";
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
