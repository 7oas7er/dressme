import "./styles.css";
import * as api from "./api.js";
import * as auth from "./auth.js";
import { renderCatalogApp } from "./catalog.js";

function renderGate(root, { cognito, message, onLogin }) {
  root.replaceChildren();
  const card = document.createElement("section");
  card.className = "panel gate-card stack";
  card.innerHTML = `
    <p class="brand">DressMe</p>
    <h1>Your wardrobe, three looks.</h1>
    <p class="lede">Sign in to browse and capture pieces you own.</p>
    <p class="status" id="status" role="status"></p>
    <div class="row">
      <button type="button" id="sign-in">Sign in</button>
      <a class="button secondary" href="/imprint.html">Imprint</a>
    </div>
  `;
  const wrap = document.createElement("div");
  wrap.className = "gate";
  wrap.append(card);
  root.append(wrap);

  const status = card.querySelector("#status");
  if (message) status.textContent = message;
  else if (!cognito || !cognito.clientId) {
    status.textContent =
      "Cognito is not configured on this environment yet. Apply stg Terraform, then reload.";
  }

  card.querySelector("#sign-in").addEventListener("click", () => {
    if (!cognito || !cognito.clientId || !cognito.authDomain) {
      status.textContent = "Cognito config missing — cannot sign in yet.";
      return;
    }
    onLogin();
  });
}

async function boot() {
  const root = document.getElementById("app");
  if (!root) return;

  let cognito = null;
  try {
    const config = await api.fetchConfig();
    cognito = config.cognito || null;
    if (cognito && !cognito.redirectUri) {
      cognito.redirectUri = `${window.location.origin}/`;
    }
    if (cognito && !cognito.logoutUrl) {
      cognito.logoutUrl = `${window.location.origin}/`;
    }
  } catch (err) {
    renderGate(root, {
      cognito: null,
      message: `Could not load /api/config (${err.message}).`,
      onLogin: () => {},
    });
    return;
  }

  try {
    await auth.completeLoginIfNeeded(cognito);
  } catch (err) {
    renderGate(root, {
      cognito,
      message: err.message || "Sign-in failed.",
      onLogin: () => auth.beginLogin(cognito),
    });
    return;
  }

  if (!auth.getIdToken()) {
    renderGate(root, {
      cognito,
      message: "",
      onLogin: () => auth.beginLogin(cognito),
    });
    return;
  }

  renderCatalogApp(root, {
    onLogout: () => auth.logout(cognito),
  });
}

boot();

export { boot };
