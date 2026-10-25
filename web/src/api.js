import { getIdToken } from "./auth.js";

async function request(path, options = {}) {
  const headers = Object.assign({ accept: "application/json" }, options.headers || {});
  const token = getIdToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(path, Object.assign({}, options, { headers }));
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
