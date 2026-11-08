"use strict";

/**
 * UC-20 — catalog overview thumbnails (~400px-wide JPEG).
 * sharp is lazy-required so unit tests can inject deps.makeThumb without native binaries.
 */

var THUMB_MAX_WIDTH = 400;
var THUMB_JPEG_QUALITY = 80;
var THUMB_CONTENT_TYPE = "image/jpeg";

function thumbKeyFor(fullKey) {
  if (!fullKey) return null;
  var base = String(fullKey).replace(/\.[^.]+$/, "");
  return base + ".thumb.jpg";
}

async function streamToBuffer(body) {
  if (!body) {
    throw new Error("empty_s3_body");
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  var chunks = [];
  for await (var chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function makeThumbWithSharp(inputBuffer) {
  var sharp = require("sharp");
  return sharp(inputBuffer)
    .rotate()
    .resize({
      width: THUMB_MAX_WIDTH,
      height: THUMB_MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * UC-18 rotate-on-edit: bake EXIF orientation, then apply a 90°-multiple user
 * step, then encode JPEG without a non-default Orientation tag.
 * Two sharp passes so EXIF normalize cannot be clobbered by the angle rotate.
 */
async function rotateOriginalWithSharp(inputBuffer, degrees) {
  var sharp = require("sharp");
  var angle = Number(degrees);
  var upright = await sharp(inputBuffer).rotate().toBuffer();
  return sharp(upright)
    .rotate(angle)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

exports.THUMB_MAX_WIDTH = THUMB_MAX_WIDTH;
exports.THUMB_JPEG_QUALITY = THUMB_JPEG_QUALITY;
exports.THUMB_CONTENT_TYPE = THUMB_CONTENT_TYPE;
exports.thumbKeyFor = thumbKeyFor;
exports.streamToBuffer = streamToBuffer;
exports.makeThumbWithSharp = makeThumbWithSharp;
exports.rotateOriginalWithSharp = rotateOriginalWithSharp;
