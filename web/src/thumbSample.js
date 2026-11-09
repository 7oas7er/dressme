/**
 * Phase 1 (Path 4a) — client-side dominant-color + light texture sample
 * from a strip thumb. Falls back silently when canvas/CORS unavailable.
 * Center-crop only (edges often background clutter).
 */

const SAMPLE_SIZE = 48;
const TEXTURE_SIZE = 32;

function canSample() {
  return (
    typeof Image !== "undefined" &&
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("thumb load failed"));
    img.src = url;
  });
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Average center-crop pixels, skipping near-white / near-black (backdrop).
 * @returns {{ dominantHex: string, textureDataUrl: string } | null}
 */
export async function sampleThumb(url) {
  if (!url || !canSample()) return null;
  let img;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const crop = Math.min(w, h) * 0.45;
  const sx = (w - crop) / 2;
  const sy = (h - crop) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, sx, sy, crop, crop, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    // Tainted canvas (CORS) — attribute-map fallback.
    return null;
  }

  let data;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return null;
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip washed-out backdrop and crushed blacks.
    if (max > 245 && min > 230) continue;
    if (max < 18) continue;
    rSum += r;
    gSum += g;
    bSum += b;
    count += 1;
  }
  if (count < 8) {
    // Too few usable pixels — use full average.
    rSum = gSum = bSum = count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count += 1;
    }
  }
  if (!count) return null;

  const dominantHex = rgbToHex(
    Math.round(rSum / count),
    Math.round(gSum / count),
    Math.round(bSum / count)
  );

  // Tiny desaturated texture tile for multiply overlay (not photo collage).
  const tex = document.createElement("canvas");
  tex.width = TEXTURE_SIZE;
  tex.height = TEXTURE_SIZE;
  const tctx = tex.getContext("2d");
  if (!tctx) return { dominantHex, textureDataUrl: "" };
  tctx.drawImage(img, sx, sy, crop, crop, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  try {
    const td = tctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    for (let i = 0; i < td.data.length; i += 4) {
      const y = Math.round(
        0.299 * td.data[i] + 0.587 * td.data[i + 1] + 0.114 * td.data[i + 2]
      );
      // Lift midtones so multiply doesn't crush the wash.
      const v = Math.min(255, Math.round(y * 0.55 + 110));
      td.data[i] = v;
      td.data[i + 1] = v;
      td.data[i + 2] = v;
      td.data[i + 3] = 255;
    }
    tctx.putImageData(td, 0, 0);
  } catch {
    return { dominantHex, textureDataUrl: "" };
  }

  let textureDataUrl = "";
  try {
    textureDataUrl = tex.toDataURL("image/png");
  } catch {
    textureDataUrl = "";
  }
  return { dominantHex, textureDataUrl };
}
