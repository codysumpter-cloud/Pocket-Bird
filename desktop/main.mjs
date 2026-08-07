import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } from "electron";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_ID = "dev.prismtek.pocketbuddy";
const PRIVATE_ART_SCHEMA = "pocket-buddy-private-art-bundle-v1";
const PRIVATE_ART_MANIFEST = "private-art-manifest.json";
const PRIVATE_ART_MAX_PACK_BYTES = 250 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;
let overlayWindow = null;
let tray = null;
let quitting = false;
let displayRefreshTimer = null;
let bundledArtCache = new Map();

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function unionDisplayBounds() {
  const displays = screen.getAllDisplays();
  if (!displays.length) return { x: 0, y: 0, width: 1280, height: 720 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function applyDesktopWindowContract(window) {
  window.setAlwaysOnTop(true, "screen-saver");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === "darwin") window.setWindowButtonVisibility?.(false);
}

function createOverlayWindow() {
  const bounds = unionDisplayBounds();
  const window = new BrowserWindow({
    ...bounds,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    titleBarStyle: "hidden",
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  applyDesktopWindowContract(window);
  window.loadFile(join(__dirname, "index.html"));
  window.once("ready-to-show", () => {
    applyDesktopWindowContract(window);
    window.showInactive();
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void import("electron").then(({ shell }) => shell.openExternal(url));
    return { action: "deny" };
  });
  return window;
}

function sendCommand(command) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  overlayWindow.webContents.send("pocket-buddy:command", command);
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = Boolean(overlayWindow?.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? "Hide Pocket Buddy" : "Show Pocket Buddy", click: () => {
      if (!overlayWindow) return;
      visible ? overlayWindow.hide() : overlayWindow.showInactive();
      refreshTrayMenu();
    } },
    { type: "separator" },
    { label: "Home", click: () => sendCommand("home") },
    { label: "Buddies & Field Guide", click: () => sendCommand("pets") },
    { label: "Care", click: () => sendCommand("care") },
    { label: "Talk", click: () => sendCommand("talk") },
    { type: "separator" },
    { label: "Quit Pocket Buddy", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const candidates = [
    join(__dirname, "..", "images", "icons", "transparent", "48x48x1.png"),
    join(__dirname, "..", "images", "icons", "transparent", "32x32x1.png"),
  ];
  let icon = nativeImage.createEmpty();
  for (const candidate of candidates) {
    const maybe = nativeImage.createFromPath(candidate);
    if (!maybe.isEmpty()) { icon = maybe; break; }
  }
  tray = new Tray(icon);
  tray.setToolTip("Pocket Buddy");
  tray.on("click", () => {
    if (!overlayWindow) return;
    overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.showInactive();
    refreshTrayMenu();
  });
  refreshTrayMenu();
}

function scheduleDisplayRefresh() {
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => {
    displayRefreshTimer = null;
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setBounds(unionDisplayBounds(), false);
    applyDesktopWindowContract(overlayWindow);
  }, 120);
}

function privateArtRootCandidates() {
  const candidates = [
    join(process.resourcesPath, "private-art"),
    process.env.PORTABLE_EXECUTABLE_DIR ? join(process.env.PORTABLE_EXECUTABLE_DIR, "Art Packs") : null,
    join(dirname(process.execPath), "Art Packs"),
    join(__dirname, "..", "private-art"),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function safeZipLeaf(value, field) {
  if (typeof value !== "string" || !value || basename(value) !== value || !/\.zip$/i.test(value)) {
    throw new Error(`Private art manifest has an unsafe ${field}.`);
  }
  return value;
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadPrivateArtRoot(root) {
  const manifestPath = join(root, PRIVATE_ART_MANIFEST);
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  let manifest;
  try { manifest = JSON.parse(raw); }
  catch { throw new Error(`Private art manifest is invalid JSON: ${manifestPath}`); }
  if (manifest?.schema !== PRIVATE_ART_SCHEMA || !Array.isArray(manifest.packs)) {
    throw new Error(`Private art manifest has the wrong schema: ${manifestPath}`);
  }
  if (manifest.packs.length > 200) throw new Error("Private art bundle contains too many packs.");

  const entries = [];
  for (const item of manifest.packs) {
    const file = safeZipLeaf(item?.file, "file");
    const importName = safeZipLeaf(item?.importName ?? file, "importName");
    const expectedSha = String(item?.sha256 ?? "").toLowerCase();
    if (!SHA256_RE.test(expectedSha)) throw new Error(`Private art entry ${file} has an invalid SHA-256.`);
    const fullPath = join(root, file);
    const info = await stat(fullPath);
    if (!info.isFile() || info.size <= 0 || info.size > PRIVATE_ART_MAX_PACK_BYTES) {
      throw new Error(`Private art entry ${file} is missing, empty, or too large.`);
    }
    const actualSha = await sha256File(fullPath);
    if (actualSha !== expectedSha) {
      throw new Error(`Private art integrity failure for ${file}: expected ${expectedSha}, got ${actualSha}.`);
    }
    entries.push({
      id: expectedSha,
      displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim().slice(0, 120) : importName.replace(/\.zip$/i, ""),
      kind: item.kind === "human" ? "human" : "buddy",
      file,
      importName,
      sha256: expectedSha,
      bytes: info.size,
      root,
      fullPath,
    });
  }
  return entries;
}

async function discoverBundledArt() {
  const merged = new Map();
  for (const root of privateArtRootCandidates()) {
    const entries = await loadPrivateArtRoot(root);
    for (const entry of entries) if (!merged.has(entry.sha256)) merged.set(entry.sha256, entry);
  }
  bundledArtCache = new Map([...merged.values()].map((entry) => [entry.id, entry]));
  return [...merged.values()].map(({ root: _root, fullPath: _fullPath, ...publicEntry }) => publicEntry);
}

async function readBundledArt(id) {
  if (!bundledArtCache.has(id)) await discoverBundledArt();
  const entry = bundledArtCache.get(id);
  if (!entry) throw new Error("Requested bundled art pack is not registered.");
  const actualSha = await sha256File(entry.fullPath);
  if (actualSha !== entry.sha256) throw new Error(`Private art integrity changed after discovery: ${entry.file}`);
  const bytes = await readFile(entry.fullPath);
  const copy = Uint8Array.from(bytes);
  return { id: entry.id, sha256: entry.sha256, importName: entry.importName, bytes: copy.buffer };
}

ipcMain.on("pocket-buddy:set-interactive", (event, interactive) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  window.setIgnoreMouseEvents(!Boolean(interactive), { forward: true });
});

ipcMain.on("pocket-buddy:quit", () => {
  quitting = true;
  app.quit();
});

ipcMain.handle("pocket-buddy:list-bundled-art", async () => discoverBundledArt());
ipcMain.handle("pocket-buddy:read-bundled-art", async (_event, id) => readBundledArt(String(id ?? "")));

app.whenReady().then(() => {
  app.setName("Pocket Buddy");
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin") app.dock?.hide();

  overlayWindow = createOverlayWindow();
  createTray();

  screen.on("display-added", scheduleDisplayRefresh);
  screen.on("display-removed", scheduleDisplayRefresh);
  screen.on("display-metrics-changed", scheduleDisplayRefresh);

  app.on("second-instance", () => {
    overlayWindow?.showInactive();
    refreshTrayMenu();
  });
  app.on("activate", () => {
    overlayWindow?.showInactive();
    refreshTrayMenu();
  });
}).catch((error) => {
  console.error("Pocket Buddy desktop shell failed to start", error);
  app.quit();
});

app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", (event) => {
  event?.preventDefault?.();
});
