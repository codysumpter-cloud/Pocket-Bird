(() => {
  const PERCH_COUNT = 9;
  const PERCH_WIDTH = 150;
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  const TINYHOUSE_NAME = /tiny\s*house|tinyhouse/i;
  const perches = [];

  function ensurePerches() {
    if (perches.length) return;
    for (let index = 0; index < PERCH_COUNT; index += 1) {
      const perch = document.createElement("img");
      perch.src = TRANSPARENT_PIXEL;
      perch.alt = "";
      perch.dataset.pocketBuddyDesktopPerch = String(index);
      perch.setAttribute("aria-hidden", "true");
      perch.style.cssText = [
        "position:fixed",
        `width:${PERCH_WIDTH}px`,
        "height:3px",
        "filter:opacity(0)",
        "pointer-events:none",
        "user-select:none",
        "z-index:-2147483647",
      ].join(";");
      document.body.appendChild(perch);
      perches.push(perch);
    }
  }

  function layoutPerches() {
    ensurePerches();
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(240, window.innerHeight);
    const usableX = Math.max(0, width - PERCH_WIDTH - 24);
    const topMin = Math.min(100, Math.max(82, height * 0.12));
    const bottomMin = Math.max(topMin, height - 100);
    const rows = [0.14, 0.25, 0.37, 0.50, 0.63, 0.76, 0.86, 0.32, 0.68];
    const columns = [0.08, 0.50, 0.82, 0.27, 0.66, 0.12, 0.48, 0.88, 0.36];

    for (let index = 0; index < perches.length; index += 1) {
      const perch = perches[index];
      const left = 12 + usableX * columns[index];
      const top = Math.max(topMin, Math.min(bottomMin, height * rows[index]));
      perch.style.left = `${Math.round(left)}px`;
      perch.style.top = `${Math.round(top)}px`;
    }
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function installEnvironmentImportBridge() {
    const library = window.PocketBuddy?.library;
    if (!library?.importFile || library.__pocketBuddyDesktopEnvironmentBridge) return false;
    const originalImport = library.importFile.bind(library);
    library.importFile = async (file) => {
      const fileName = typeof file?.name === "string" ? file.name : "";
      if (!TINYHOUSE_NAME.test(fileName)) return originalImport(file);
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      return {
        version: 1,
        id: `environment-tinyhouse-${hash.slice(0, 12)}`,
        displayName: "TinyHouse Home Art",
        description: "Verified private Pixel Salvaje TinyHouse environment pack.",
        kind: "environment",
        source: "private-home-art",
        archiveName: fileName,
        archiveSha256: hash,
        canonical: false,
      };
    };
    Object.defineProperty(library, "__pocketBuddyDesktopEnvironmentBridge", { value: true });
    return true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", layoutPerches, { once: true });
  } else {
    layoutPerches();
  }
  window.addEventListener("resize", layoutPerches, { passive: true });
  window.addEventListener("pocket-buddy-core-ready", installEnvironmentImportBridge, { once: true });
  const bridgeTimer = setInterval(() => {
    if (installEnvironmentImportBridge()) clearInterval(bridgeTimer);
  }, 50);
  setTimeout(() => clearInterval(bridgeTimer), 15000);
})();
