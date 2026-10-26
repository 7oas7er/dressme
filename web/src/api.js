import { getIdToken } from "./auth.js";

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const piece = bytes[i].toString(16);
    hex += piece.length === 1 ? `0${piece}` : piece;
  }
  return hex;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufferToHex(digest);
}

async function request(path, options = {}) {
  const headers = Object.assign({ accept: "application/json" }, options.headers || {});
  const token = getIdToken();
  if (token) {
    // CloudFront OAC (signing_behavior=always) overwrites Authorization with SigV4
    // for the Lambda Function URL. Send the Cognito ID token on x-id-token too.
    headers.authorization = `Bearer ${token}`;
    headers["x-id-token"] = token;
  }

  let body = options.body;
  if (body != null && body !== "") {
    if (typeof body !== "string") {
      body = JSON.stringify(body);
    }
    if (!headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    // Required for CloudFront → Lambda Function URL OAC on POST/PUT/PATCH.
    headers["x-amz-content-sha256"] = await sha256Hex(body);
  }

  const res = await fetch(path, Object.assign({}, options, { headers, body }));
  if (res.status === 204) {
    return null;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: "invalid_response", raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fetchConfig() {
  return request("/api/config");
}

export function listItems(q = "") {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return request(`/api/items${query}`);
}

export function listAttributeOptions() {
  return request("/api/attribute-options");
}

export function getItem(itemId) {
  return request(`/api/items/${encodeURIComponent(itemId)}`);
}

export function createItem(payload) {
  return request("/api/items", { method: "POST", body: JSON.stringify(payload) });
}

export function updateItem(itemId, payload) {
  return request(`/api/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteItem(itemId) {
  return request(`/api/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function confirmPhotos(itemId, photoIds) {
  return request(`/api/items/${encodeURIComponent(itemId)}/photos/complete`, {
    method: "POST",
    body: JSON.stringify({ photoIds }),
  });
}

export async function uploadFiles(uploads, files) {
  const ready = [];
  for (let i = 0; i < uploads.length; i++) {
    const slot = uploads[i];
    const file = files[i];
    if (!slot || !file) continue;
    const put = await fetch(slot.uploadUrl, {
      method: "PUT",
      headers: { "content-type": slot.contentType || file.type || "image/jpeg" },
      body: file,
    });
    if (!put.ok) {
      throw new Error(`upload_failed:${slot.photoId}`);
    }
    ready.push(slot.photoId);
  }
  return ready;
}
