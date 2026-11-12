import assert from "node:assert/strict";
import test from "node:test";

/**
 * Focused SPA auth tests: expired ID tokens must not be treated as valid;
 * refresh_token redeem near expiry; refresh failure clears the session.
 */

function installSessionStorage() {
  const map = new Map();
  globalThis.sessionStorage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
  return map;
}

async function loadAuth() {
  installSessionStorage();
  // Fresh module state per test (cognitoConfig / refreshPromise).
  return import(`../../web/src/auth.js?t=${Date.now()}-${Math.random()}`);
}

test("loadSession / getIdToken never return an expired idToken", async () => {
  const auth = await loadAuth();
  auth.saveSession({
    idToken: "expired.jwt",
    refreshToken: "refresh-abc",
    expiresAt: Date.now() - 60_000,
  });
  assert.equal(auth.loadSession(), null);
  assert.equal(auth.getIdToken(), null);
});

test("loadSession returns a still-valid session", async () => {
  const auth = await loadAuth();
  const session = {
    idToken: "fresh.jwt",
    refreshToken: "refresh-abc",
    expiresAt: Date.now() + 3_600_000,
  };
  auth.saveSession(session);
  assert.equal(auth.getIdToken(), "fresh.jwt");
  assert.equal(auth.loadSession().idToken, "fresh.jwt");
});

test("ensureSession redeems refresh_token near expiry", async () => {
  const auth = await loadAuth();
  auth.configureAuth({
    clientId: "client-1",
    authDomain: "https://auth.example.com",
  });
  auth.saveSession({
    idToken: "stale.jwt",
    accessToken: "stale.access",
    refreshToken: "refresh-abc",
    expiresAt: Date.now() - 1_000,
  });

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: String(options.body) });
    return {
      ok: true,
      async json() {
        return {
          id_token: "new.id",
          access_token: "new.access",
          expires_in: 3600,
        };
      },
    };
  };

  try {
    const session = await auth.ensureSession();
    assert.equal(session.idToken, "new.id");
    assert.equal(session.refreshToken, "refresh-abc");
    assert.ok(session.expiresAt > Date.now() + 3_000_000);
    assert.equal(auth.getIdToken(), "new.id");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /oauth2\/token$/);
    assert.match(calls[0].body, /grant_type=refresh_token/);
    assert.match(calls[0].body, /refresh_token=refresh-abc/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureSession clears session when refresh fails", async () => {
  const auth = await loadAuth();
  auth.configureAuth({
    clientId: "client-1",
    authDomain: "https://auth.example.com",
  });
  auth.saveSession({
    idToken: "stale.jwt",
    refreshToken: "refresh-abc",
    expiresAt: Date.now() - 1_000,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, async json() { return {}; } });

  try {
    const session = await auth.ensureSession();
    assert.equal(session, null);
    assert.equal(auth.getIdToken(), null);
    assert.equal(auth.loadSession(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getValidIdToken returns null for expired session without refresh token", async () => {
  const auth = await loadAuth();
  auth.saveSession({
    idToken: "stale.jwt",
    expiresAt: Date.now() - 1_000,
  });
  assert.equal(await auth.getValidIdToken(), null);
  assert.equal(auth.loadSession(), null);
});
