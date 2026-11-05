"use strict";

/**
 * B2 — transparent garment cutouts (lean sharp path, no rembg / no ONNX).
 *
 * v3 matte for real wardrobe photos (doors, hangers, mirrors, wrinkled sheets):
 * multi-prototype corner/edge bg, full-border seed, shadow-tolerant fill,
 * edge-aware stop, largest-opaque-component keep, soft feather, content crop.
 * Free-tier friendly (same class of work as UC-20 thumbs).
 */

var CUTOUT_MAX_EDGE = 1024;
var CUTOUT_CONTENT_TYPE = "image/webp";
var CUTOUT_WEBP_QUALITY = 82;
/** Bump when the matte changes so staging can force-regenerate existing keys. */
var CUTOUT_VERSION = 3;
/**
 * Seed threshold: border pixels must be this close to a bg prototype to start
 * the flood (keeps garment-on-edge from seeding removal).
 */
var SEED_THRESHOLD = 30;
/**
 * Fill threshold: once seeded, flood may continue into slightly different bg
 * (handles mild gradients / paper texture without eating the garment).
 */
var FILL_THRESHOLD = 58;
/**
 * Never treat a pixel as background if it is this much darker (luminance)
 * than the nearest bg prototype — unless shadow-mode accepts it.
 * Protects pale shirts/trousers on white paper.
 */
var LUM_GUARD = 14;
/**
 * Shadow-tolerant fill: allow darker pixels than bg when chroma still matches
 * after luminance lift (wrinkled sheet / soft door shadows).
 * MIN_DROP must sit above typical pale-garment ΔL vs white paper (~10–20) so
 * shirts/trousers are not classified as sheet shadows.
 */
var SHADOW_MIN_DROP = 28;
var SHADOW_MAX_DROP = 90;
var SHADOW_CHROMA = 22;
/** Soft alpha ramp below FILL_THRESHOLD (RGB distance units). */
var SOFT_RAMP = 14;
/** Morphological soft-edge iterations (each ~0.5px feel). */
var FEATHER_PASSES = 2;
/** Extra transparent padding kept around the cropped subject (fraction of max edge). */
var CROP_PAD_FRAC = 0.03;
var CROP_PAD_MIN = 4;
/**
 * Sobel magnitude above this blocks fill across a strong edge unless the
 * pixel is a near-exact bg seed match (pale shirt vs white door).
 */
var EDGE_STOP = 48;
/** Opaque threshold when picking the largest subject component. */
var SUBJECT_ALPHA_MIN = 40;

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

function patchMedian(data, width, height, x0, y0, patch) {
  var rs = [];
  var gs = [];
  var bs = [];
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
  if (!rs.length) return { r: 255, g: 255, b: 255 };
  return {
    r: medianChannel(rs),
    g: medianChannel(gs),
    b: medianChannel(bs),
  };
}

/**
 * Multi-prototype background from four corners + edge midpoints.
 * Real wardrobe shots often have a door in one corner and a closet in another;
 * a single median collapses both and stops the flood early.
 *
 * Edge midpoints (and garment-touched corners) are kept only when they stay
 * near the lightest corner luminance — otherwise a shirt/trouser on the frame
 * would become a "bg" prototype and eat the subject.
 */
function sampleBackgroundProtos(data, width, height) {
  var patch = Math.max(2, Math.min(16, (Math.min(width, height) * 0.08) | 0));
  var corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  var cornerProtos = [];
  var i;
  for (i = 0; i < corners.length; i++) {
    cornerProtos.push(
      patchMedian(data, width, height, corners[i][0], corners[i][1], patch)
    );
  }
  var lightest = 0;
  for (i = 0; i < cornerProtos.length; i++) {
    var cl = luminance(cornerProtos[i].r, cornerProtos[i].g, cornerProtos[i].b);
    if (cl > lightest) lightest = cl;
  }
  // Allow mild door/closet variation; reject garment-darkened patches.
  // Slack must stay below typical pale-shirt ΔL vs white paper (~15–20) or an
  // edge-midpoint shirt sample becomes a bg prototype and eats the subject.
  var lumFloor = lightest - 12;
  var protos = [];
  for (i = 0; i < cornerProtos.length; i++) {
    if (
      luminance(cornerProtos[i].r, cornerProtos[i].g, cornerProtos[i].b) >=
      lumFloor
    ) {
      protos.push(cornerProtos[i]);
    }
  }
  if (!protos.length) {
    // Degenerate: all corners dark — keep the lightest corner anyway.
    var best = cornerProtos[0];
    var bestL = -1;
    for (i = 0; i < cornerProtos.length; i++) {
      var l = luminance(cornerProtos[i].r, cornerProtos[i].g, cornerProtos[i].b);
      if (l > bestL) {
        bestL = l;
        best = cornerProtos[i];
      }
    }
    protos.push(best);
  }

  var midX = Math.max(0, ((width - patch) / 2) | 0);
  var midY = Math.max(0, ((height - patch) / 2) | 0);
  var edgePatches = [
    [midX, 0],
    [midX, height - patch],
    [0, midY],
    [width - patch, midY],
  ];
  for (i = 0; i < edgePatches.length; i++) {
    var ep = patchMedian(
      data,
      width,
      height,
      edgePatches[i][0],
      edgePatches[i][1],
      patch
    );
    if (luminance(ep.r, ep.g, ep.b) >= lumFloor) {
      protos.push(ep);
    }
  }
  return protos;
}

/** @deprecated kept for tests / callers that want a single summary bg. */
function sampleBorderBackground(data, width, height) {
  var protos = sampleBackgroundProtos(data, width, height);
  var rs = [];
  var gs = [];
  var bs = [];
  for (var i = 0; i < protos.length; i++) {
    rs.push(protos[i].r);
    gs.push(protos[i].g);
    bs.push(protos[i].b);
  }
  return {
    r: medianChannel(rs),
    g: medianChannel(gs),
    b: medianChannel(bs),
  };
}

function nearestProto(r, g, b, protos) {
  var best = protos[0];
  var bestD = Infinity;
  for (var i = 0; i < protos.length; i++) {
    var p = protos[i];
    var d = colorDist(r, g, b, p.r, p.g, p.b);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { proto: best, dist: bestD };
}

/**
 * True when pixel is a darker shadow of the bg prototype (same chroma, lower lum).
 */
function isShadowOfBg(r, g, b, proto) {
  var bgLum = luminance(proto.r, proto.g, proto.b);
  var lum = luminance(r, g, b);
  var drop = bgLum - lum;
  if (drop < SHADOW_MIN_DROP || drop > SHADOW_MAX_DROP) return false;
  if (lum < 1) return false;
  // Lift pixel toward bg luminance, then compare chroma.
  var scale = bgLum / lum;
  var lr = Math.min(255, r * scale);
  var lg = Math.min(255, g * scale);
  var lb = Math.min(255, b * scale);
  return colorDist(lr, lg, lb, proto.r, proto.g, proto.b) <= SHADOW_CHROMA;
}

/**
 * Sobel magnitude (approx) for edge-aware flood stop. Greyscale from luminance.
 */
function sobelMagnitude(data, width, height) {
  var n = width * height;
  var lum = new Float32Array(n);
  var i;
  for (i = 0; i < n; i++) {
    var off = i * 4;
    lum[i] = luminance(data[off], data[off + 1], data[off + 2]);
  }
  var mag = new Float32Array(n);
  for (var y = 1; y < height - 1; y++) {
    for (var x = 1; x < width - 1; x++) {
      var idx = y * width + x;
      var tl = lum[idx - width - 1];
      var tc = lum[idx - width];
      var tr = lum[idx - width + 1];
      var ml = lum[idx - 1];
      var mr = lum[idx + 1];
      var bl = lum[idx + width - 1];
      var bc = lum[idx + width];
      var br = lum[idx + width + 1];
      var gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      var gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      mag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

/**
 * Keep the largest opaque connected component; clear smaller leftovers
 * (door plates, floor strips, hanger islands that stayed opaque).
 * Tie-break: component whose centroid is closest to frame center.
 */
function keepLargestOpaqueComponent(out, width, height, alphaMin) {
  var n = width * height;
  var labels = new Int32Array(n);
  var areas = [];
  var sumX = [];
  var sumY = [];
  var nextLabel = 1;
  var x;
  var y;
  var i;

  function alphaAt(p) {
    return out[p * 4 + 3];
  }

  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      i = y * width + x;
      if (alphaAt(i) <= alphaMin || labels[i]) continue;
      var label = nextLabel++;
      areas[label] = 0;
      sumX[label] = 0;
      sumY[label] = 0;
      var stack = [i];
      labels[i] = label;
      while (stack.length) {
        var p = stack.pop();
        areas[label]++;
        var px = p % width;
        var py = (p / width) | 0;
        sumX[label] += px;
        sumY[label] += py;
        var nbrs = [p - 1, p + 1, p - width, p + width];
        for (var k = 0; k < 4; k++) {
          var q = nbrs[k];
          if (q < 0 || q >= n) continue;
          var qx = q % width;
          // Prevent wrap on left/right.
          if (k < 2 && Math.abs(qx - px) !== 1) continue;
          if (labels[q] || alphaAt(q) <= alphaMin) continue;
          labels[q] = label;
          stack.push(q);
        }
      }
    }
  }

  if (nextLabel <= 1) return;

  var cx = (width - 1) / 2;
  var cy = (height - 1) / 2;
  var bestLabel = 1;
  var bestArea = areas[1] || 0;
  var bestDist = Infinity;
  for (var lab = 1; lab < nextLabel; lab++) {
    var area = areas[lab] || 0;
    if (!area) continue;
    var acx = sumX[lab] / area;
    var acy = sumY[lab] / area;
    var dist = (acx - cx) * (acx - cx) + (acy - cy) * (acy - cy);
    if (
      area > bestArea ||
      (area === bestArea && dist < bestDist)
    ) {
      bestArea = area;
      bestLabel = lab;
      bestDist = dist;
    }
  }

  // Ignore tiny "subjects" — if largest is < 0.5% of frame, leave matte alone.
  if (bestArea < Math.max(16, (n * 0.005) | 0)) return;

  for (i = 0; i < n; i++) {
    if (alphaAt(i) > alphaMin && labels[i] !== bestLabel) {
      out[i * 4 + 3] = 0;
    }
  }
}

/**
 * Flood-fill from the border: mark pixels similar to any bg prototype that
 * are connected to the edge. Seed is stricter than fill (hysteresis).
 * Shadow-tolerant fill clears wrinkled-sheet / soft door shadows that broke
 * v2 corner-only floods. Edge stop protects pale garments on near-white doors.
 */
function matteRgba(data, width, height) {
  var protos = sampleBackgroundProtos(data, width, height);
  var edgeMag = sobelMagnitude(data, width, height);
  var n = width * height;
  var isBg = new Uint8Array(n);
  var queue = new Int32Array(n);
  var qh = 0;
  var qt = 0;
  var x;
  var y;
  var idx;
  var i;

  function nearestAt(p) {
    var off = p * 4;
    return nearestProto(data[off], data[off + 1], data[off + 2], protos);
  }

  function tryEnqueue(px, py, threshold, allowShadow) {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    var p = py * width + px;
    if (isBg[p]) return;
    var off = p * 4;
    var r = data[off];
    var g = data[off + 1];
    var b = data[off + 2];
    var near = nearestProto(r, g, b, protos);
    var dist = near.dist;
    var proto = near.proto;
    var bgLum = luminance(proto.r, proto.g, proto.b);
    var lum = luminance(r, g, b);
    var darker = bgLum - lum;
    var shadowOk = allowShadow && isShadowOfBg(r, g, b, proto);

    // Luminance guard first: pale garments can sit inside SEED_THRESHOLD of
    // white paper/doors; without this, full-border seed eats them (v2 corner
    // seed avoided that; v3 keeps full-border seed + this guard).
    if (darker >= LUM_GUARD && !shadowOk) return;
    if (dist > threshold && !shadowOk) return;

    // Edge-aware stop: do not cross strong edges unless near-exact bg match.
    if (edgeMag[p] >= EDGE_STOP && dist > SEED_THRESHOLD && !shadowOk) {
      return;
    }

    isBg[p] = 1;
    queue[qt++] = p;
  }

  // Seed from the full border (v2 corner-only left door/floor plates).
  for (x = 0; x < width; x++) {
    tryEnqueue(x, 0, SEED_THRESHOLD, false);
    tryEnqueue(x, height - 1, SEED_THRESHOLD, false);
  }
  for (y = 0; y < height; y++) {
    tryEnqueue(0, y, SEED_THRESHOLD, false);
    tryEnqueue(width - 1, y, SEED_THRESHOLD, false);
  }

  while (qh < qt) {
    var p = queue[qh++];
    var cx = p % width;
    var cy = (p / width) | 0;
    tryEnqueue(cx - 1, cy, FILL_THRESHOLD, true);
    tryEnqueue(cx + 1, cy, FILL_THRESHOLD, true);
    tryEnqueue(cx, cy - 1, FILL_THRESHOLD, true);
    tryEnqueue(cx, cy + 1, FILL_THRESHOLD, true);
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
    var dist = nearestAt(i).dist;
    if (dist >= softLo) {
      var t = (dist - softLo) / (FILL_THRESHOLD - softLo || 1);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      out[off + 3] = Math.round(t * 255);
    } else {
      out[off + 3] = 0;
    }
  }

  keepLargestOpaqueComponent(out, width, height, SUBJECT_ALPHA_MIN);

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
exports.sampleBackgroundProtos = sampleBackgroundProtos;
exports.sampleBorderBackground = sampleBorderBackground;
exports.isShadowOfBg = isShadowOfBg;
exports.matteRgba = matteRgba;
exports.contentBBox = contentBBox;
exports.keepLargestOpaqueComponent = keepLargestOpaqueComponent;
exports.makeCutoutWithSharp = makeCutoutWithSharp;
