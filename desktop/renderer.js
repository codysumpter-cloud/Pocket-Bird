(() => {
  const bridge = window.PocketBuddyDesktop;
  if (!bridge) return;

  let lastInteractive = null;
  let shadowRoot = null;

  function setInteractive(value) {
    const next = Boolean(value);
    if (next === lastInteractive) return;
    lastInteractive = next;
    bridge.setInteractive(next);
  }

  function findShadowRoot() {
    if (shadowRoot?.host?.isConnected) return shadowRoot;
    const host = document.getElementById("birb-shadow-host");
    shadowRoot = host?.shadowRoot ?? null;
    return shadowRoot;
  }

  function isInteractiveElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.id === "birb" || element.id === "pocket-buddy-custom-pet") return true;
    if (element.closest("#birb-menu, #birb-field-guide, .birb-window, .pb-window, .pb-home, .pb-toast, .pb-private-art-error")) return true;
    if (element.matches("button, input, select, textarea, a, [role='button']")) return true;
    const cursor = getComputedStyle(element).cursor;
    return cursor === "pointer" || cursor === "grab" || cursor === "grabbing";
  }

  function pointerIsInteractive(clientX, clientY) {
    const root = findShadowRoot();
    if (!root) return false;
    if (root.querySelector(".pb-home")) return true;
    const elements = root.elementsFromPoint?.(clientX, clientY) ?? [];
    return elements.some(isInteractiveElement);
  }

  document.addEventListener("mousemove", (event) => {
    setInteractive(pointerIsInteractive(event.clientX, event.clientY));
  }, { passive: true });

  document.addEventListener("mouseleave", () => setInteractive(false), { passive: true });
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  const interval = setInterval(() => {
    if (findShadowRoot()) {
      clearInterval(interval);
      setInteractive(false);
    }
  }, 50);

  bridge.onCommand((command) => {
    const buddy = window.PocketBuddy;
    if (!buddy) return;
    if (command === "home") buddy.home?.open?.();
    else if (command === "pets") buddy.showPets?.();
    else if (command === "care") buddy.showCare?.();
    else if (command === "talk") buddy.showTalk?.();
    setTimeout(() => setInteractive(true), 0);
  });

  function setPrivateArtStatus(status) {
    window.PocketBuddyPrivateArt = Object.freeze({ ...status, updatedAt: Date.now() });
    window.dispatchEvent(new CustomEvent("pocket-buddy-private-art-status", { detail: window.PocketBuddyPrivateArt }));
  }

  function showPrivateArtError(error) {
    const root = findShadowRoot();
    if (!root || root.querySelector(".pb-private-art-error")) return;
    const panel = document.createElement("div");
    panel.className = "pb-private-art-error";
    panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:2147483647;max-width:420px;padding:10px;border:3px solid #3b3045;background:#fff0f0;color:#2d2634;box-shadow:5px 5px 0 #3b3045;font:12px Monocraft,monospace;pointer-events:auto;";
    const title = document.createElement("strong");
    title.textContent = "Pocket Buddy art integrity error";
    const detail = document.createElement("div");
    detail.style.marginTop = "6px";
    detail.textContent = error instanceof Error ? error.message : String(error);
    const hint = document.createElement("div");
    hint.style.marginTop = "6px";
    hint.textContent = "Bundled art was not substituted. Fix or replace the private art bundle, then restart Pocket Buddy.";
    panel.append(title, detail, hint);
    root.append(panel);
    setInteractive(true);
  }

  async function waitForPocketBuddy(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (window.PocketBuddy?.library?.importFile) return window.PocketBuddy;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Pocket Buddy core did not become ready for bundled art installation.");
  }

  function normalizeBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value && typeof value === "object" && Array.isArray(value.data)) return Uint8Array.from(value.data);
    throw new Error("Desktop bridge returned an invalid bundled art payload.");
  }

  async function installBundledArt() {
    try {
      setPrivateArtStatus({ state: "checking", total: 0, installed: 0, skipped: 0, failures: [] });
      const entries = await bridge.listBundledArt();
      if (!Array.isArray(entries) || entries.length === 0) {
        setPrivateArtStatus({ state: "none", total: 0, installed: 0, skipped: 0, failures: [] });
        return;
      }

      const buddy = await waitForPocketBuddy();
      const alreadyInstalled = await buddy.library.listInstalled();
      const installedHashes = new Set((Array.isArray(alreadyInstalled) ? alreadyInstalled : []).map((pack) => pack?.archiveSha256).filter(Boolean));
      let installed = 0;
      let skipped = 0;
      const installedPacks = [];

      for (const entry of entries) {
        if (!entry?.sha256 || !entry?.importName) throw new Error("Bundled art manifest entry is incomplete.");
        if (installedHashes.has(entry.sha256)) {
          skipped += 1;
          continue;
        }
        const payload = await bridge.readBundledArt(entry.id);
        if (payload?.sha256 !== entry.sha256) throw new Error(`Bundled art bridge SHA mismatch for ${entry.displayName || entry.importName}.`);
        const bytes = normalizeBytes(payload.bytes);
        const file = new File([bytes], entry.importName, { type: "application/zip", lastModified: 0 });
        const pack = await buddy.library.importFile(file);
        if (pack?.archiveSha256 !== entry.sha256) throw new Error(`Pocket Buddy importer SHA mismatch for ${entry.displayName || entry.importName}.`);
        installedHashes.add(entry.sha256);
        installedPacks.push(pack);
        installed += 1;
      }

      await buddy.home?.reloadHuman?.();
      setPrivateArtStatus({
        state: "ready",
        total: entries.length,
        installed,
        skipped,
        failures: [],
        packs: entries.map((entry) => ({ displayName: entry.displayName, kind: entry.kind, sha256: entry.sha256 })),
      });
      if (installedPacks.length) window.dispatchEvent(new CustomEvent("pocket-buddy-private-art-installed", { detail: { packs: installedPacks } }));
    } catch (error) {
      console.error("Pocket Buddy private art installation failed", error);
      setPrivateArtStatus({ state: "error", total: 0, installed: 0, skipped: 0, failures: [error instanceof Error ? error.message : String(error)] });
      showPrivateArtError(error);
    }
  }

  void installBundledArt();
})();
