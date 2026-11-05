import assert from "node:assert/strict";
import test from "node:test";
import { collagePhotoUrl, lookHeadline, lookSummary } from "../../web/src/suggest.js";

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
  assert.equal(
    lookSummary({
      items: [
        { color: "navy", outfitRole: "outerwear", type: "blazer" },
        { color: "white", outfitRole: "shirt", type: "oxford" },
      ],
    }),
    "navy outerwear · white shirt"
  );
  assert.match(lookSummary({ items: [] }), /No pieces/);
});
