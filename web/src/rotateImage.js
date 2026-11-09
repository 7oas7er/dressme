/**
 * Client-side +90° CW image rotate for UC-18 edit photos.
 * Decodes via createImageBitmap (EXIF-aware when supported), canvas rotate,
 * JPEG encode. Used for optimistic tile preview + durable re-upload.
 *
 * Signed S3 GETs are often first loaded by plain <img> (no Origin), so WebKit /
 * Chromium cache a response without Access-Control-Allow-Origin. A later
 * fetch()/crossOrigin load of the same URL then fails with Safari's
 * TypeError "Load failed". Bypass that cache with cache: "no-store".
 */

const ROTATE_JPEG_QUALITY = 0.9;

/**
 * Decode a Blob to ImageBitmap, preferring EXIF orientation bake-in.
 * Falls back to plain createImageBitmap, then <img> draw.
 */
async function decodeBitmap(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      try {
        return await createImageBitmap(blob);
      } catch {
        // Fall through to HTMLImageElement.
      }
    }
  }
  return decodeViaImageElement(blob);
}

function decodeViaImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    img.src = url;
  });
}

function sourceSize(source) {
  if (source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  return { width, height };
}

/**
 * Rotate decoded pixels +90° clockwise and encode as JPEG.
 * @param {Blob|File} blob
 * @param {{ quality?: number }} [options]
 * @returns {Promise<Blob>}
 */
export async function rotateImageBlob(blob, { quality = ROTATE_JPEG_QUALITY } = {}) {
  if (!blob) {
    throw new Error("image_rotate_failed");
  }
  const bitmap = await decodeBitmap(blob);
  const { width, height } = sourceSize(bitmap);
  if (!width || !height) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("image_rotate_failed");
  }

  const canvas = document.createElement("canvas");
  // +90° CW swaps dimensions.
  canvas.width = height;
  canvas.height = width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("canvas_unavailable");
  }
  ctx.translate(height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();

  const jpeg = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (out) resolve(out);
        else reject(new Error("image_encode_failed"));
      },
      "image/jpeg",
      quality
    );
  });
  return jpeg;
}

function isLikelyCorsFetchError(err) {
  const msg = String((err && err.message) || err || "");
  return (
    /load failed/i.test(msg) ||
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /access.?control/i.test(msg)
  );
}

/**
 * Load bytes from a signed media URL without reusing a non-CORS image cache entry.
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function fetchImageBlob(url) {
  if (!url) {
    throw new Error("image_fetch_failed");
  }
  let res;
  try {
    // cache: "no-store" is required — see file header. Do not add unsigned
    // query params (breaks S3 signatures) or custom headers (preflight).
    res = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    if (isLikelyCorsFetchError(err)) {
      throw new Error("image_cors_failed");
    }
    throw new Error("image_fetch_failed");
  }
  if (!res.ok) {
    throw new Error("image_fetch_failed");
  }
  return res.blob();
}

/**
 * Fetch a (CORS-enabled) image URL and return a +90° CW JPEG Blob.
 * @param {string} url
 * @param {{ quality?: number }} [options]
 * @returns {Promise<Blob>}
 */
export async function rotateImageFromUrl(url, options) {
  const blob = await fetchImageBlob(url);
  return rotateImageBlob(blob, options);
}

export { ROTATE_JPEG_QUALITY };
