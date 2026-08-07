import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_ID = "dev.prismtek.pocketbuddy";
let overlayWindow = null;
let tray = null;
let quitting = false;
let displayRefreshTimer = null;

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

ipcMain.on("pocket-buddy:set-interactive", (event, interactive) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  window.setIgnoreMouseEvents(!Boolean(interactive), { forward: true });
});

ipcMain.on("pocket-buddy:quit", () => {
  quitting = true;
  app.quit();
});

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
