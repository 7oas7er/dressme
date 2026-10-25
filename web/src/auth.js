const STORAGE_KEY = "dressme.auth.v1";

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToBase64Url(digest);
}

function randomString(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bufferToBase64Url(array);
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.idToken) return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt - 30_000) {
      return parsed.refreshToken ? parsed : null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function getIdToken() {
  const session = loadSession();
  return session && session.idToken ? session.idToken : null;
}

export async function beginLogin(cognito) {
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(16);
  sessionStorage.setItem(
    "dressme.pkce",
    JSON.stringify({ verifier, state, redirectUri: cognito.redirectUri })
  );

  const url = new URL(`${cognito.authDomain}/oauth2/authorize`);
  url.searchParams.set("client_id", cognito.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", cognito.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  window.location.assign(url.toString());
}

export async function completeLoginIfNeeded(cognito) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return loadSession();

  const raw = sessionStorage.getItem("dressme.pkce");
  const pkce = raw ? JSON.parse(raw) : null;
  const state = params.get("state");
  if (!pkce || !pkce.verifier || (pkce.state && state && pkce.state !== state)) {
    throw new Error("Login state mismatch. Try signing in again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cognito.clientId,
    code,
    redirect_uri: pkce.redirectUri || cognito.redirectUri,
    code_verifier: pkce.verifier,
  });

  const res = await fetch(`${cognito.authDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("Could not finish sign-in.");
  }
  const tokens = await res.json();
  const session = {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  saveSession(session);
  sessionStorage.removeItem("dressme.pkce");
  window.history.replaceState({}, document.title, window.location.pathname);
  return session;
}

export function logout(cognito) {
  clearSession();
  if (!cognito || !cognito.authDomain || !cognito.clientId) {
    window.location.assign("/");
    return;
  }
  const url = new URL(`${cognito.authDomain}/logout`);
  url.searchParams.set("client_id", cognito.clientId);
  url.searchParams.set("logout_uri", cognito.logoutUrl || cognito.redirectUri);
  window.location.assign(url.toString());
}
