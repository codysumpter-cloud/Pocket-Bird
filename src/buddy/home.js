const SHA256_RE = /^[0-9a-f]{64}$/;

function cleanHash(value) {
  const hash = String(value ?? "").toLowerCase();
  return SHA256_RE.test(hash) ? hash : "";
}

export function createHome({ brain, petRuntime, petLibrary, onClose = () => {} }) {
  let openState = false;
  let lastError = "";

  async function homeHumanPack() {
    const id = await petLibrary.homeHumanId();
    if (!id) return null;
    return (await petLibrary.listInstalled()).find((pack) => pack.id === id) ?? null;
  }

  async function open() {
    const bridge = window.PocketBuddyDesktop;
    if (!bridge?.openHome) {
      lastError = "Canonical Home is currently available in Pocket Buddy desktop builds. No substitute room will be rendered.";
      console.error(`Pocket Buddy: ${lastError}`);
      throw new Error(lastError);
    }

    const human = await homeHumanPack();
    const humanSha256 = cleanHash(human?.archiveSha256);
    if (!humanSha256) {
      lastError = "Home requires the exact verified Ani Iso Human pack. No substitute player will be rendered.";
      throw new Error(lastError);
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
    if (!result?.ok) {
      lastError = result?.error || "Canonical Home did not open.";
      throw new Error(lastError);
    }
    openState = true;
    lastError = "";
    return result;
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
