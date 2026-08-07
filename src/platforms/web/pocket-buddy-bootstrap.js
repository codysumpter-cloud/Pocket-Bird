// Pocket Buddy web bootstrap.
// Keeps the Pocket Bird-derived runtime/art intact while giving Pocket Buddy a
// stable, self-owned embed entry point and mobile viewport guard.

(() => {
  "use strict";

  const GLOBAL_KEY = "__POCKET_BUDDY_EMBED__";
  if (window[GLOBAL_KEY]?.status === "ready" || window[GLOBAL_KEY]?.status === "loading") return;

  const currentScript = document.currentScript;
  const sourceUrl = currentScript instanceof HTMLScriptElement ? currentScript.src : "";
  const runtimeUrl = sourceUrl
    ? new URL("birb.embed.js", sourceUrl).href
    : "./birb.embed.js";

  const state = {
    version: "2026.08.07.1",
    status: "loading",
    runtimeUrl,
    error: null,
  };
  window[GLOBAL_KEY] = state;

  function applyMobileViewportGuard(shadowRoot) {
    if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    if (shadowRoot.getElementById("pocket-buddy-ios-viewport-guard")) return;

    const style = document.createElement("style");
    style.id = "pocket-buddy-ios-viewport-guard";
    style.textContent = `
      #birb:not(.birb-absolute) {
        bottom: calc(92px + env(safe-area-inset-bottom)) !important;
      }
    `;
    shadowRoot.appendChild(style);
  }

  function markReady(host) {
    const shadowRoot = host?.shadowRoot;
    if (!shadowRoot) return false;
    applyMobileViewportGuard(shadowRoot);
    state.status = "ready";
    window.dispatchEvent(new CustomEvent("pocket-buddy-ready", { detail: { version: state.version } }));
    return true;
  }

  function watchForRuntime() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const host = document.getElementById("birb-shadow-host");
      if (markReady(host)) {
        window.clearInterval(timer);
        return;
      }
      if (attempts >= 240) {
        window.clearInterval(timer);
        state.status = "error";
        state.error = "Pocket Bird runtime did not create birb-shadow-host.";
        console.error("Pocket Buddy:", state.error);
      }
    }, 50);
  }

  const existingHost = document.getElementById("birb-shadow-host");
  if (markReady(existingHost)) return;

  const runtimeScript = document.createElement("script");
  runtimeScript.src = runtimeUrl;
  runtimeScript.defer = true;
  runtimeScript.dataset.pocketBuddyRuntime = "true";
  runtimeScript.addEventListener("load", watchForRuntime, { once: true });
  runtimeScript.addEventListener("error", () => {
    state.status = "error";
    state.error = `Failed to load Pocket Buddy runtime from ${runtimeUrl}`;
    console.error("Pocket Buddy:", state.error);
  }, { once: true });
  document.head.appendChild(runtimeScript);
})();
