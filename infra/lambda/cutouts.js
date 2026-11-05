"use strict";

/**
 * B2 — transparent garment cutouts (lean sharp path, no rembg).
 * Edge-connected color-distance matte: removes background reachable from
 * the image border. Free-tier friendly (same class of work as UC-20 thumbs).
 */

var CUTOUT_MAX_EDGE = 1024;
var CUTOUT_CONTENT_TYPE = "image/webp";
var CUTOUT_WEBP_QUALITY = 82;
/** RGB Euclidean distance vs sampled border background. */
var COLOR_THRESHOLD = 42;
/** Soft alpha ramp width (pixels) around the matte edge. */
var FEATHER_PX = 2;

function cutoutKeyFor(fullKey) {
  if (!fullKey) return null;
  var base = String(fullKey).replace(/\.[^.]+$/, "");
  return base + ".cutout.webp";
}

function colorDist(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2;
  var dg = g1 - g2;
  var db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Sample median-ish border color (average of edge pixels) as background seed.
 */
function sampleBorderBackground(data, width, height) {
  var sumR = 0;
  var sumG = 0;
  var sumB = 0;
  var count = 0;
  var x;
  var y;
  var i;

  function add(px, py) {
    var idx = (py * width + px) * 4;
    sumR += data[idx];
    sumG += data[idx + 1];
    sumB += data[idx + 2];
    count += 1;
  }

  for (x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }

  if (!count) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
}

/**
 * Flood-fill from the border: mark pixels similar to bg that are connected
 * to the edge. Then feather alpha on the boundary.
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

  function tryEnqueue(px, py) {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    var p = py * width + px;
    if (isBg[p]) return;
    var off = p * 4;
    if (
      colorDist(
        data[off],
        data[off + 1],
        data[off + 2],
        bg.r,
        bg.g,
        bg.b
      ) > COLOR_THRESHOLD
    ) {
      return;
    }
    isBg[p] = 1;
    queue[qt++] = p;
  }

  for (x = 0; x < width; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, height - 1);
  }
  for (y = 1; y < height - 1; y++) {
    tryEnqueue(0, y);
    tryEnqueue(width - 1, y);
  }

  while (qh < qt) {
    var p = queue[qh++];
    var cx = p % width;
    var cy = (p / width) | 0;
    tryEnqueue(cx - 1, cy);
    tryEnqueue(cx + 1, cy);
    tryEnqueue(cx, cy - 1);
    tryEnqueue(cx, cy + 1);
  }

  // Soften: for bg pixels near foreground, raise alpha based on color distance.
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
    var dist = colorDist(
      data[off],
      data[off + 1],
      data[off + 2],
      bg.r,
      bg.g,
      bg.b
    );
    if (dist >= COLOR_THRESHOLD - 8) {
      // Near threshold → partial alpha for a softer edge.
      var t = (dist - (COLOR_THRESHOLD - 8)) / 8;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      out[off + 3] = Math.round(t * 255);
    } else {
      out[off + 3] = 0;
    }
  }

  // Light morphological feather: shrink hard bg one step when a neighbor is fg.
  if (FEATHER_PX > 0) {
    var alpha = new Uint8Array(n);
    for (i = 0; i < n; i++) alpha[i] = out[i * 4 + 3];
    for (y = 1; y < height - 1; y++) {
      for (x = 1; x < width - 1; x++) {
        idx = y * width + x;
        if (alpha[idx] > 0) continue;
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
          out[idx * 4 + 3] = Math.round(maxN * 0.45);
        }
      }
    }
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

  return sharp(matted, {
    raw: { width: width, height: height, channels: 4 },
  })
    .webp({ quality: CUTOUT_WEBP_QUALITY, alphaQuality: 90 })
    .toBuffer();
}

exports.CUTOUT_MAX_EDGE = CUTOUT_MAX_EDGE;
exports.CUTOUT_CONTENT_TYPE = CUTOUT_CONTENT_TYPE;
exports.CUTOUT_WEBP_QUALITY = CUTOUT_WEBP_QUALITY;
exports.cutoutKeyFor = cutoutKeyFor;
exports.matteRgba = matteRgba;
exports.makeCutoutWithSharp = makeCutoutWithSharp;
