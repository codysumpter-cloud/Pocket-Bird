const SHA256_RE = /^[0-9a-f]{64}$/;

function cleanHash(value) {
  const hash = String(value ?? "").toLowerCase();
  return SHA256_RE.test(hash) ? hash : "";
}

export function createHome({ brain, petRuntime, petLibrary, shadowRoot, onClose = () => {} }) {
  let openState = false;
  let lastError = "";

  function showError(message) {
    lastError = String(message || "Home could not open.");
    shadowRoot?.querySelector(".pb-home-launch-error")?.remove();
    if (!shadowRoot) return;
    const panel = document.createElement("div");
    panel.className = "pb-home-launch-error";
    panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:2147483647;max-width:420px;padding:9px;border:3px solid var(--birb-border-color);background:var(--birb-background-color);box-shadow:5px 5px 0 var(--birb-border-color);font:12px Monocraft,monospace;color:#2d2634;pointer-events:auto;";
    const title = document.createElement("strong");
    title.textContent = "Pocket Buddy Home";
    const detail = document.createElement("div");
    detail.style.marginTop = "5px";
    detail.textContent = lastError;
    const closeButton = document.createElement("button");
    closeButton.textContent = "OK";
    closeButton.style.cssText = "margin-top:7px;font:inherit;border:2px solid var(--birb-border-color);background:var(--birb-background-color);padding:4px 8px;";
    closeButton.onclick = () => panel.remove();
    panel.append(title, detail, closeButton);
    shadowRoot.append(panel);
  }

  async function homeHumanPack() {
    const id = await petLibrary.homeHumanId();
    if (!id) return null;
    return (await petLibrary.listInstalled()).find((pack) => pack.id === id) ?? null;
  }

  async function open() {
    try {
      const bridge = window.PocketBuddyDesktop;
      if (!bridge?.openHome) {
        throw new Error("Canonical Home is currently available in Pocket Buddy desktop builds. No substitute room will be rendered.");
      }

      const human = await homeHumanPack();
      const humanSha256 = cleanHash(human?.archiveSha256);
      if (!humanSha256) {
        throw new Error("Home requires the exact verified Ani Iso Human pack. No substitute player will be rendered.");
      }

      const active = petRuntime.activePack();
      const petSha256 = cleanHash(active?.archiveSha256);
      const result = await bridge.openHome({
        humanSha256,
        petSha256,
        petScale: petRuntime.scaleMultiplier(),
        uiScale: petRuntime.uiScaleMultiplier(),
        humanScale: 1.2,
        buddyName: brain.snapshot().displayName,
      });
      if (!result?.ok) throw new Error(result?.error || "Canonical Home did not open.");
      openState = true;
      lastError = "";
      shadowRoot?.querySelector(".pb-home-launch-error")?.remove();
      return result;
    } catch (error) {
      openState = false;
      showError(error instanceof Error ? error.message : String(error));
      console.error("Pocket Buddy canonical Home failed to open", error);
      return { ok: false, error: lastError };
    }
  }

  function close() {
    window.PocketBuddyDesktop?.closeHome?.();
    openState = false;
    onClose();
  }

  return {
    open,
    close,
    isOpen: () => openState,
    lastError: () => lastError,
    async reloadHuman() {},
  };
}
