"use strict";

/**
 * B2 — transparent garment cutouts (lean sharp path, no rembg).
 * Edge-connected color-distance matte tuned for flat-lay wardrobe shots:
 * corner-biased bg seed, hysteresis flood-fill, soft feather, content crop.
 * Free-tier friendly (same class of work as UC-20 thumbs).
 */

var CUTOUT_MAX_EDGE = 1024;
var CUTOUT_CONTENT_TYPE = "image/webp";
var CUTOUT_WEBP_QUALITY = 82;
/** Bump when the matte changes so staging can force-regenerate existing keys. */
var CUTOUT_VERSION = 2;
/**
 * Seed threshold: corner pixels must be this close to the corner bg to start
 * the flood (keeps garment-on-edge from seeding removal).
 */
var SEED_THRESHOLD = 28;
/**
 * Fill threshold: once seeded, flood may continue into slightly different bg
 * (handles mild gradients / paper texture without eating the garment).
 */
var FILL_THRESHOLD = 52;
/**
 * Never treat a pixel as background if it is this much darker (luminance)
 * than the sampled bg — protects pale shirts/trousers on white paper that
 * still sit inside the RGB fill threshold.
 */
var LUM_GUARD = 10;
/** Soft alpha ramp below FILL_THRESHOLD (RGB distance units). */
var SOFT_RAMP = 12;
/** Morphological soft-edge iterations (each ~0.5px feel). */
var FEATHER_PASSES = 2;
/** Extra transparent padding kept around the cropped subject (fraction of max edge). */
var CROP_PAD_FRAC = 0.03;
var CROP_PAD_MIN = 4;

function cutoutKeyFor(fullKey) {
  if (!fullKey) return null;
  var base = String(fullKey).replace(/\.[^.]+$/, "");
  return base + ".cutout.webp";
}

function colorDist(r1, g1, b1, r2, g2, b2) {
  // Weighted Euclidean — greens dominate perception; helps pale shirts on white paper.
  var dr = r1 - r2;
  var dg = g1 - g2;
  var db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / Math.sqrt(9);
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function medianChannel(values) {
  if (!values.length) return 0;
  var sorted = values.slice().sort(function (a, b) {
    return a - b;
  });
  var mid = (sorted.length / 2) | 0;
  if (sorted.length % 2) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Sample background from four corner patches (median), ignoring garment pixels
 * that often touch mid-edges of flat-lay photos.
 */
function sampleBorderBackground(data, width, height) {
  var patch = Math.max(2, Math.min(16, (Math.min(width, height) * 0.08) | 0));
  var rs = [];
  var gs = [];
  var bs = [];

  function addPatch(x0, y0) {
    var x1 = Math.min(width, x0 + patch);
    var y1 = Math.min(height, y0 + patch);
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var idx = (y * width + x) * 4;
        rs.push(data[idx]);
        gs.push(data[idx + 1]);
        bs.push(data[idx + 2]);
      }
    }
  }

  addPatch(0, 0);
  addPatch(width - patch, 0);
  addPatch(0, height - patch);
  addPatch(width - patch, height - patch);

  if (!rs.length) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: medianChannel(rs),
    g: medianChannel(gs),
    b: medianChannel(bs),
  };
}

/**
 * Flood-fill from the border: mark pixels similar to bg that are connected
 * to the edge. Seed is stricter than fill (hysteresis) so garment touching
 * the frame does not open a removal path into the subject.
 */
function matteRgba(data, width, height) {
  var bg = sampleBorderBackground(data, width, height);
  var n = width * height;
  var isBg = new Uint8Array(n);
  var queue = new Int32Array(n);
  var qh = 0;
  var qt = 0;
  var x;
  var y;
  var idx;
  var i;

  function distAt(p) {
    var off = p * 4;
    return colorDist(
      data[off],
      data[off + 1],
      data[off + 2],
      bg.r,
      bg.g,
      bg.b
    );
  }

  var bgLum = luminance(bg.r, bg.g, bg.b);

  function tryEnqueue(px, py, threshold) {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    var p = py * width + px;
    if (isBg[p]) return;
    var off = p * 4;
    // Garments are typically darker than paper/studio bg — bail before color dist.
    if (bgLum - luminance(data[off], data[off + 1], data[off + 2]) >= LUM_GUARD) {
      return;
    }
    if (distAt(p) > threshold) return;
    isBg[p] = 1;
    queue[qt++] = p;
  }

  // Seed only from corner patches (not mid-edges). Flat-lay garments often
  // touch the bottom/side frame; corner-only seeds stop them opening a flood.
  var seedPatch = Math.max(2, Math.min(16, (Math.min(width, height) * 0.08) | 0));
  function seedPatchAt(x0, y0) {
    var x1 = Math.min(width, x0 + seedPatch);
    var y1 = Math.min(height, y0 + seedPatch);
    for (var sy = y0; sy < y1; sy++) {
      for (var sx = x0; sx < x1; sx++) {
        tryEnqueue(sx, sy, SEED_THRESHOLD);
      }
    }
  }
  seedPatchAt(0, 0);
  seedPatchAt(width - seedPatch, 0);
  seedPatchAt(0, height - seedPatch);
  seedPatchAt(width - seedPatch, height - seedPatch);

  while (qh < qt) {
    var p = queue[qh++];
    var cx = p % width;
    var cy = (p / width) | 0;
    tryEnqueue(cx - 1, cy, FILL_THRESHOLD);
    tryEnqueue(cx + 1, cy, FILL_THRESHOLD);
    tryEnqueue(cx, cy - 1, FILL_THRESHOLD);
    tryEnqueue(cx, cy + 1, FILL_THRESHOLD);
  }

  var softLo = FILL_THRESHOLD - SOFT_RAMP;
  if (softLo < 0) softLo = 0;

  var out = Buffer.alloc(n * 4);
  for (i = 0; i < n; i++) {
    var off = i * 4;
    out[off] = data[off];
    out[off + 1] = data[off + 1];
    out[off + 2] = data[off + 2];
    if (!isBg[i]) {
      out[off + 3] = data[off + 3];
      continue;
    }
    var dist = distAt(i);
    if (dist >= softLo) {
      var t = (dist - softLo) / (FILL_THRESHOLD - softLo || 1);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      out[off + 3] = Math.round(t * 255);
    } else {
      out[off + 3] = 0;
    }
  }

  // Morphological feather: pull a soft fringe onto hard transparent edges.
  var pass;
  for (pass = 0; pass < FEATHER_PASSES; pass++) {
    var alpha = new Uint8Array(n);
    for (i = 0; i < n; i++) alpha[i] = out[i * 4 + 3];
    for (y = 1; y < height - 1; y++) {
      for (x = 1; x < width - 1; x++) {
        idx = y * width + x;
        if (alpha[idx] > 40) continue;
        var maxN = 0;
        var nOff;
        nOff = alpha[idx - 1];
        if (nOff > maxN) maxN = nOff;
        nOff = alpha[idx + 1];
        if (nOff > maxN) maxN = nOff;
        nOff = alpha[idx - width];
        if (nOff > maxN) maxN = nOff;
        nOff = alpha[idx + width];
        if (nOff > maxN) maxN = nOff;
        if (maxN > 0) {
          var soft = Math.round(maxN * 0.4);
          if (soft > out[idx * 4 + 3]) out[idx * 4 + 3] = soft;
        }
      }
    }
  }

  return out;
}

/**
 * Bounding box of pixels with alpha above `alphaMin`, plus padding.
 * Returns null when the matte is empty (caller keeps full frame).
 */
function contentBBox(data, width, height, alphaMin) {
  var minX = width;
  var minY = height;
  var maxX = -1;
  var maxY = -1;
  var x;
  var y;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  var pad = Math.max(
    CROP_PAD_MIN,
    Math.round(Math.max(width, height) * CROP_PAD_FRAC)
  );
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function extractRgba(data, width, height, box) {
  var out = Buffer.alloc(box.width * box.height * 4);
  for (var y = 0; y < box.height; y++) {
    var srcRow = ((box.top + y) * width + box.left) * 4;
    var dstRow = y * box.width * 4;
    data.copy(out, dstRow, srcRow, srcRow + box.width * 4);
  }
  return out;
}

async function makeCutoutWithSharp(inputBuffer) {
  var sharp = require("sharp");
  var resized = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: CUTOUT_MAX_EDGE,
      height: CUTOUT_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  var width = resized.info.width;
  var height = resized.info.height;
  var matted = matteRgba(resized.data, width, height);
  var box = contentBBox(matted, width, height, 12);
  var raw = matted;
  var outW = width;
  var outH = height;
  if (box && box.width > 0 && box.height > 0) {
    // Skip crop when almost the full frame is subject (avoids needless re-encode jitter).
    var areaRatio = (box.width * box.height) / (width * height);
    if (areaRatio < 0.92) {
      raw = extractRgba(matted, width, height, box);
      outW = box.width;
      outH = box.height;
    }
  }

  return sharp(raw, {
    raw: { width: outW, height: outH, channels: 4 },
  })
    .webp({ quality: CUTOUT_WEBP_QUALITY, alphaQuality: 90 })
    .toBuffer();
}

exports.CUTOUT_MAX_EDGE = CUTOUT_MAX_EDGE;
exports.CUTOUT_CONTENT_TYPE = CUTOUT_CONTENT_TYPE;
exports.CUTOUT_WEBP_QUALITY = CUTOUT_WEBP_QUALITY;
exports.CUTOUT_VERSION = CUTOUT_VERSION;
exports.SEED_THRESHOLD = SEED_THRESHOLD;
exports.FILL_THRESHOLD = FILL_THRESHOLD;
exports.cutoutKeyFor = cutoutKeyFor;
exports.matteRgba = matteRgba;
exports.contentBBox = contentBBox;
exports.makeCutoutWithSharp = makeCutoutWithSharp;
