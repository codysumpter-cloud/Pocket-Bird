import { openZipArchive, pngDimensions } from "./zip.js";

const HOME_KEY = "home.state.v3";
const TINYHOUSE_NAME = /tiny\s*house|tinyhouse/i;
const ART_SCALE = 1.25;
const TW = 64 * ART_SCALE;
const TH = 40 * ART_SCALE;
const SOURCE_TILE = 64;
const FURNITURE = ["chair", "table", "bed", "sofa", "lamp", "plant", "door"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const key = (x, y) => `${x},${y}`;

const TINYHOUSE = Object.freeze({
  floor: {
    wood: "Floor_Wall_Tiles_64/Floor_64_WoodLight.png",
    stone: "Floor_Wall_Tiles_64/Floor_64_Stone.png",
    grass: "Floor_Wall_Tiles_64/Floor_64_Green.png",
    water: "Floor_Wall_Tiles_64/Floor_64_BlueSea.png",
  },
  wallLeft: "Floor_Wall_Tiles_64/Wall_L_64_White.png",
  wallRight: "Floor_Wall_Tiles_64/Wall_R_64_White.png",
  furniture: {
    bed: { path: "Bedroom/Bed_A_4.png", crop: [16, 38, 100, 60] },
    table: { path: "Living Roon/Table_10.png", crop: [23, 45, 74, 71] },
    chair: { path: "Chairs/Chair_2_A_Tile.png", crop: [17, 7, 32, 53] },
    sofa: { path: "Sofa/Sofa_3_A_Tile.png", crop: [12, 28, 108, 87] },
    plant: { path: "Plants/Plant_1.png", crop: [2, 0, 25, 32] },
    lamp: { path: "Lamp/Lamp_8_A_Tile.png", crop: [11, 0, 21, 30] },
    door: { path: "Doors/Door_2_Brown.png", crop: [38, 3, 51, 122] },
  },
});

function defaultState() {
  const floors = {};
  for (let y = 0; y < 6; y += 1) for (let x = 0; x < 8; x += 1) floors[key(x, y)] = "wood";
  return {
    width: 8,
    height: 6,
    floors,
    walls: {},
    furniture: [
      { id: "bed", type: "bed", x: 1.5, y: 1.3 },
      { id: "table", type: "table", x: 4.2, y: 2.5 },
      { id: "chair", type: "chair", x: 5.1, y: 2.5 },
      { id: "sofa", type: "sofa", x: 2.4, y: 4.2 },
      { id: "plant", type: "plant", x: 6.7, y: 1.2 },
      { id: "door", type: "door", x: 7.4, y: 3 },
    ],
    human: { x: 3.3, y: 3.4 },
    buddy: { x: 4.3, y: 3.3 },
    mode: "play",
    buildMode: "none",
    floorBrush: "wood",
    furnitureBrush: "chair",
  };
}

function clean(raw) {
  const d = defaultState();
  const s = raw && typeof raw === "object" ? raw : {};
  const width = clamp(Number.isInteger(s.width) ? s.width : d.width, 3, 16);
  const height = clamp(Number.isInteger(s.height) ? s.height : d.height, 3, 12);
  return {
    width,
    height,
    floors: s.floors && typeof s.floors === "object" ? { ...s.floors } : d.floors,
    walls: s.walls && typeof s.walls === "object" ? { ...s.walls } : {},
    furniture: Array.isArray(s.furniture)
      ? s.furniture.filter((i) => i && FURNITURE.includes(i.type)).slice(0, 120).map((i, n) => ({
          id: String(i.id || `${i.type}-${n}`),
          type: i.type,
          x: clamp(Number(i.x) || 1, 0.5, width - 0.5),
          y: clamp(Number(i.y) || 1, 0.5, height - 0.5),
        }))
      : d.furniture,
    human: {
      x: clamp(Number(s.human?.x) || d.human.x, 0.2, width - 0.2),
      y: clamp(Number(s.human?.y) || d.human.y, 0.2, height - 0.2),
    },
    buddy: {
      x: clamp(Number(s.buddy?.x) || d.buddy.x, 0.2, width - 0.2),
      y: clamp(Number(s.buddy?.y) || d.buddy.y, 0.2, height - 0.2),
    },
    mode: s.mode === "idle" ? "idle" : "play",
    buildMode: ["none", "floor", "erase", "wall", "furniture", "remove"].includes(s.buildMode) ? s.buildMode : "none",
    floorBrush: ["wood", "stone", "grass", "water"].includes(s.floorBrush) ? s.floorBrush : "wood",
    furnitureBrush: FURNITURE.includes(s.furnitureBrush) ? s.furnitureBrush : "chair",
  };
}

const iso = (o, x, y) => ({ x: o.x + (x - y) * TW / 2, y: o.y + (x + y) * TH / 2 });
const inverse = (o, x, y) => ({
  x: ((x - o.x) / (TW / 2) + (y - o.y) / (TH / 2)) / 2,
  y: ((y - o.y) / (TH / 2) - (x - o.x) / (TW / 2)) / 2,
});
const direction = (dx, dy, fallback = "south") => Math.hypot(dx, dy) < 0.01
  ? fallback
  : ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];

function normalizeBytes(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  if (value && typeof value === "object" && Array.isArray(value.data)) return Uint8Array.from(value.data).buffer;
  throw new Error("Home art bridge returned invalid bytes.");
}

function tinyHouseEntry(entries) {
  return (Array.isArray(entries) ? entries : []).find((entry) =>
    entry?.kind === "environment"
      || TINYHOUSE_NAME.test(`${entry?.displayName ?? ""} ${entry?.file ?? ""} ${entry?.importName ?? ""}`),
  ) ?? null;
}

function suffixPath(paths, suffix) {
  const normalized = String(suffix).replace(/^\/+/, "").toLowerCase();
  const candidates = [...paths].filter((path) => !path.startsWith("__MACOSX/") && path.toLowerCase().endsWith(normalized));
  if (candidates.length !== 1) throw new Error(`TinyHouse is missing one exact asset: ${suffix}`);
  return candidates[0];
}

async function decodePng(bytes) {
  const blob = new Blob([bytes], { type: "image/png" });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("TinyHouse PNG could not be decoded.")); };
    image.src = url;
  });
}

async function loadTinyHouseArt() {
  const bridge = window.PocketBuddyDesktop;
  if (!bridge?.listBundledArt || !bridge?.readBundledArt) {
    throw new Error("TinyHouse Home art is not installed in this Pocket Buddy build.");
  }
  const entries = await bridge.listBundledArt();
  const entry = tinyHouseEntry(entries);
  if (!entry?.id || !entry?.sha256) throw new Error("Verified TinyHouse Home art bundle is missing.");
  const payload = await bridge.readBundledArt(entry.id);
  if (payload?.sha256 !== entry.sha256) throw new Error("TinyHouse Home art failed its SHA-256 integrity check.");
  const zip = await openZipArchive(normalizeBytes(payload.bytes));
  const assets = { floors: {}, furniture: {}, environmentSha256: entry.sha256, displayName: entry.displayName || "TinyHouse" };

  for (const [id, suffix] of Object.entries(TINYHOUSE.floor)) {
    const path = suffixPath(zip.paths, suffix);
    const bytes = await zip.read(path);
    const size = pngDimensions(bytes);
    if (size.width !== 64 || size.height !== 64) throw new Error(`TinyHouse ${id} floor is ${size.width}×${size.height}; expected 64×64.`);
    assets.floors[id] = await decodePng(bytes);
  }

  for (const [keyName, suffix] of [["wallLeft", TINYHOUSE.wallLeft], ["wallRight", TINYHOUSE.wallRight]]) {
    const path = suffixPath(zip.paths, suffix);
    const bytes = await zip.read(path);
    const size = pngDimensions(bytes);
    if (size.width !== 64 || size.height !== 64) throw new Error(`TinyHouse wall art has invalid dimensions: ${size.width}×${size.height}.`);
    assets[keyName] = await decodePng(bytes);
  }

  for (const [id, spec] of Object.entries(TINYHOUSE.furniture)) {
    const path = suffixPath(zip.paths, spec.path);
    const bytes = await zip.read(path);
    const size = pngDimensions(bytes);
    if (id === "door") {
      if (size.width !== 640 || size.height !== 128) throw new Error(`TinyHouse door sheet is ${size.width}×${size.height}; expected 640×128.`);
    } else if (![32, 64, 128].includes(size.width) || size.width !== size.height) {
      throw new Error(`TinyHouse ${id} art has invalid dimensions: ${size.width}×${size.height}.`);
    }
    assets.furniture[id] = { image: await decodePng(bytes), crop: spec.crop };
  }
  return assets;
}

function nearest(s, type, from) {
  return s.furniture
    .filter((i) => !type || i.type === type)
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0] || null;
}

function drawFloor(ctx, image, p) {
  ctx.drawImage(image, 0, 0, SOURCE_TILE, SOURCE_TILE, Math.round(p.x - 32 * ART_SCALE), Math.round(p.y - 16 * ART_SCALE), Math.round(64 * ART_SCALE), Math.round(64 * ART_SCALE));
}

function drawWall(ctx, image, p) {
  ctx.drawImage(image, 0, 0, 64, 64, Math.round(p.x - 32 * ART_SCALE), Math.round(p.y - 47 * ART_SCALE), Math.round(64 * ART_SCALE), Math.round(64 * ART_SCALE));
}

function drawFurniture(ctx, asset, p) {
  const [sx, sy, sw, sh] = asset.crop;
  const scale = ART_SCALE;
  ctx.drawImage(asset.image, sx, sy, sw, sh, Math.round(p.x - sw * scale / 2), Math.round(p.y + TH / 2 - sh * scale), Math.round(sw * scale), Math.round(sh * scale));
}

export function createHome({ storage, brain, petRuntime, petLibrary, shadowRoot, onClose = () => {} }) {
  let s = defaultState();
  let root = null;
  let canvas = null;
  let c = null;
  let buildbar = null;
  let raf = 0;
  let last = performance.now();
  let keys = new Set();
  let humanRuntime = null;
  let hdir = "south";
  let bdir = "south";
  let hgoal = null;
  let bgoal = null;
  let lastPlan = 0;
  let lastCare = 0;
  let drag = null;
  let art = null;
  let uiScaleObserver = null;

  const save = () => void storage.setJson(HOME_KEY, s);
  const origin = () => ({ x: canvas.width / 2, y: Math.max(90, 105 * petRuntime.uiScaleMultiplier()) });

  async function load() {
    s = clean(await storage.getJson(HOME_KEY, null));
    const id = await petLibrary.homeHumanId();
    humanRuntime = id ? await petRuntime.runtimeFor(id) : null;
    art = await loadTinyHouseArt();
    if (!humanRuntime) throw new Error("Home requires the verified Ani Iso Human pack. No substitute human will be drawn.");
  }

  function applyUiScale() {
    if (!root) return;
    root.style.setProperty("--pb-ui-scale", String(petRuntime.uiScaleMultiplier()));
  }

  function style() {
    if (shadowRoot.getElementById("pb-home-style")) return;
    const e = document.createElement("style");
    e.id = "pb-home-style";
    e.textContent = `
      .pb-home{--pb-ui-scale:1;position:fixed;inset:8px;z-index:2147483645;background:#24342c;border:calc(3px * var(--pb-ui-scale)) solid var(--birb-border-color);box-shadow:calc(6px * var(--pb-ui-scale)) calc(6px * var(--pb-ui-scale)) 0 var(--birb-border-color);display:flex;flex-direction:column;font-family:Monocraft,monospace;color:#2d2634;pointer-events:auto;overflow:hidden}
      .pb-homebar,.pb-buildbar{display:flex;gap:calc(5px * var(--pb-ui-scale));align-items:center;flex-wrap:wrap;background:var(--birb-background-color);border-bottom:calc(2px * var(--pb-ui-scale)) solid var(--birb-border-color);padding:calc(5px * var(--pb-ui-scale));font-size:calc(11px * var(--pb-ui-scale));line-height:1.25}
      .pb-home button,.pb-home select{font:inherit;border:calc(2px * var(--pb-ui-scale)) solid var(--birb-border-color);background:#fff8e9;padding:calc(5px * var(--pb-ui-scale)) calc(7px * var(--pb-ui-scale));color:#2d2634;min-height:calc(25px * var(--pb-ui-scale))}
      .pb-home button.active{background:var(--birb-highlight)}
      .pb-stage{position:relative;flex:1;min-height:0;background:#24342c}
      .pb-stage canvas{width:100%;height:100%;image-rendering:pixelated;touch-action:none}
      .pb-status{position:absolute;left:calc(8px * var(--pb-ui-scale));bottom:calc(8px * var(--pb-ui-scale));background:var(--birb-background-color);border:calc(2px * var(--pb-ui-scale)) solid var(--birb-border-color);padding:calc(5px * var(--pb-ui-scale));font-size:calc(10px * var(--pb-ui-scale));max-width:76%;line-height:1.25}
      .pb-dpad{position:absolute;right:calc(10px * var(--pb-ui-scale));bottom:calc(10px * var(--pb-ui-scale));display:grid;grid-template-columns:repeat(3,calc(40px * var(--pb-ui-scale)));grid-template-rows:repeat(2,calc(40px * var(--pb-ui-scale)));gap:calc(3px * var(--pb-ui-scale))}
      .pb-dpad .u{grid-column:2}.pb-dpad .l{grid-column:1;grid-row:2}.pb-dpad .d{grid-column:2;grid-row:2}.pb-dpad .r{grid-column:3;grid-row:2}
      .pb-home-blocked{position:fixed;inset:8px;z-index:2147483646;background:var(--birb-background-color);border:3px solid var(--birb-border-color);display:flex;align-items:center;justify-content:center;font-family:Monocraft,monospace;pointer-events:auto}
      .pb-home-blocked>div{max-width:620px;padding:22px;text-align:center}.pb-home-blocked button{font:inherit;margin-top:12px;border:2px solid var(--birb-border-color);background:#fff8e9;padding:7px 10px}
      @media(min-width:700px){.pb-dpad{display:none}}
    `;
    shadowRoot.appendChild(e);
  }

  const button = (text, fn) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = fn;
    return b;
  };

  function blocked(error) {
    style();
    root = document.createElement("div");
    root.className = "pb-home-blocked";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Home art integrity check blocked this room";
    const message = document.createElement("div");
    message.style.marginTop = "10px";
    message.textContent = error instanceof Error ? error.message : String(error);
    const note = document.createElement("div");
    note.style.marginTop = "8px";
    note.textContent = "Pocket Buddy will not replace missing TinyHouse/Ani art with generic shapes.";
    content.append(title, message, note, button("Leave Home", close));
    root.append(content);
    shadowRoot.append(root);
  }

  function ui() {
    if (!root || !root.classList.contains("pb-home")) return;
    root.querySelectorAll("[data-mode]").forEach((e) => e.classList.toggle("active", e.dataset.mode === s.mode));
    root.querySelectorAll("[data-build]").forEach((e) => e.classList.toggle("active", e.dataset.build === s.buildMode));
    buildbar.style.display = s.buildMode === "none" ? "none" : "flex";
    applyUiScale();
  }

  async function open() {
    if (root) return;
    try {
      await load();
    } catch (error) {
      blocked(error);
      return;
    }
    style();
    root = document.createElement("div");
    root.className = "pb-home";
    applyUiScale();

    const bar = document.createElement("div");
    bar.className = "pb-homebar";
    const title = document.createElement("strong");
    title.textContent = `${brain.snapshot().displayName}'s Home`;
    const play = button("Play", () => { s.mode = "play"; save(); ui(); });
    play.dataset.mode = "play";
    const idle = button("Idle", () => { s.mode = "idle"; keys.clear(); save(); ui(); });
    idle.dataset.mode = "idle";
    bar.append(
      title,
      play,
      idle,
      button("Build", () => { s.buildMode = s.buildMode === "none" ? "floor" : "none"; save(); ui(); }),
      button("Pet", () => { petRuntime.react("heart", 1650); void brain.care("pet"); }),
      button("Feed", () => { petRuntime.react("eating", 1400); void brain.care("feed"); }),
    );
    const spacer = document.createElement("span");
    spacer.style.flex = "1";
    bar.append(spacer, button("Leave Home", close));

    buildbar = document.createElement("div");
    buildbar.className = "pb-buildbar";
    for (const [m, label] of [["floor", "Floor"], ["erase", "Erase"], ["wall", "Wall"], ["furniture", "Furniture"], ["remove", "Remove"]]) {
      const b = button(label, () => { s.buildMode = m; save(); ui(); });
      b.dataset.build = m;
      buildbar.append(b);
    }
    const fs = document.createElement("select");
    for (const x of ["wood", "stone", "grass", "water"]) {
      const o = document.createElement("option");
      o.value = x;
      o.textContent = x;
      fs.append(o);
    }
    fs.value = s.floorBrush;
    fs.onchange = () => { s.floorBrush = fs.value; save(); };
    const fur = document.createElement("select");
    for (const x of FURNITURE) {
      const o = document.createElement("option");
      o.value = x;
      o.textContent = x;
      fur.append(o);
    }
    fur.value = s.furnitureBrush;
    fur.onchange = () => { s.furnitureBrush = fur.value; save(); };
    buildbar.append(fs, fur, button("Reset", () => {
      if (confirm("Reset this Home layout?")) { s = defaultState(); save(); ui(); }
    }));

    const stage = document.createElement("div");
    stage.className = "pb-stage";
    canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 760;
    c = canvas.getContext("2d");
    c.imageSmoothingEnabled = false;
    const status = document.createElement("div");
    status.className = "pb-status";
    status.id = "pb-status";
    const pad = document.createElement("div");
    pad.className = "pb-dpad";
    for (const [d, cl, t] of [["up", "u", "↑"], ["left", "l", "←"], ["down", "d", "↓"], ["right", "r", "→"]]) {
      const b = button(t, () => {});
      b.className = cl;
      const on = (e) => { e.preventDefault(); keys.add(d); };
      const off = (e) => { e.preventDefault(); keys.delete(d); };
      b.onpointerdown = on;
      b.onpointerup = off;
      b.onpointercancel = off;
      b.onpointerleave = off;
      pad.append(b);
    }
    stage.append(canvas, status, pad);
    root.append(bar, buildbar, stage);
    shadowRoot.append(root);
    ui();
    uiScaleObserver = new MutationObserver(applyUiScale);
    uiScaleObserver.observe(shadowRoot.host, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    canvas.onpointerdown = pdown;
    canvas.onpointermove = pmove;
    canvas.onpointerup = pup;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function close() {
    if (!root) return;
    cancelAnimationFrame(raf);
    raf = 0;
    uiScaleObserver?.disconnect();
    uiScaleObserver = null;
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("keyup", keyup, true);
    shadowRoot.getElementById("pb-home-style")?.remove();
    root.remove();
    root = canvas = c = buildbar = null;
    drag = null;
    save();
    onClose();
  }

  const mapping = { w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right" };
  function keydown(e) {
    if (!root || !root.classList.contains("pb-home") || s.mode !== "play") return;
    const m = mapping[e.key.toLowerCase()];
    if (m) { keys.add(m); e.preventDefault(); e.stopPropagation(); }
  }
  function keyup(e) {
    const m = mapping[e.key.toLowerCase()];
    if (m) keys.delete(m);
  }

  function cell(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * canvas.width / r.width;
    const y = (e.clientY - r.top) * canvas.height / r.height;
    const q = inverse(origin(), x, y - TH / 2);
    return { x: Math.floor(q.x + 0.5), y: Math.floor(q.y + 0.5) };
  }

  function pdown(e) {
    if (s.buildMode === "none") return;
    const q = cell(e);
    if (q.x < 0 || q.y < 0 || q.x >= s.width || q.y >= s.height) return;
    const t = { x: q.x + 0.5, y: q.y + 0.5 };
    if (s.buildMode === "floor") s.floors[key(q.x, q.y)] = s.floorBrush;
    else if (s.buildMode === "erase") delete s.floors[key(q.x, q.y)];
    else if (s.buildMode === "wall") s.walls[key(q.x, q.y)] = !s.walls[key(q.x, q.y)];
    else if (s.buildMode === "remove") {
      const i = nearest(s, null, t);
      if (i && Math.hypot(i.x - t.x, i.y - t.y) < 1.2) s.furniture = s.furniture.filter((x) => x.id !== i.id);
    } else {
      const i = nearest(s, null, t);
      if (i && Math.hypot(i.x - t.x, i.y - t.y) < 0.8) {
        drag = i;
        canvas.setPointerCapture?.(e.pointerId);
      } else {
        s.furniture.push({ id: `${s.furnitureBrush}-${Date.now()}`, type: s.furnitureBrush, x: t.x, y: t.y });
      }
    }
    save();
  }

  function pmove(e) {
    if (!drag) return;
    const q = cell(e);
    drag.x = clamp(q.x + 0.5, 0.5, s.width - 0.5);
    drag.y = clamp(q.y + 0.5, 0.5, s.height - 0.5);
  }
  function pup(e) {
    if (!drag) return;
    save();
    drag = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }

  const floorAt = (x, y) => Boolean(s.floors[key(Math.floor(x), Math.floor(y))]);
  function move(a, dx, dy, speed, dt) {
    if (!dx && !dy) return { dx: 0, dy: 0 };
    const n = Math.hypot(dx, dy) || 1;
    const sx = dx / n * speed * dt;
    const sy = dy / n * speed * dt;
    const nx = clamp(a.x + sx, 0.15, s.width - 0.15);
    const ny = clamp(a.y + sy, 0.15, s.height - 0.15);
    if (floorAt(nx, a.y)) a.x = nx;
    if (floorAt(a.x, ny)) a.y = ny;
    return { dx: sx, dy: sy };
  }

  async function plan(now) {
    if (now - lastPlan < 4500) return;
    lastPlan = now;
    const snap = brain.snapshot();
    const need = snap.dominantNeed;
    let t = need === "food" ? nearest(s, "table", s.human) : need === "sleep" ? nearest(s, "bed", s.human) : need === "play" ? nearest(s, "sofa", s.human) : null;
    t = t || { x: s.buddy.x + 0.7, y: s.buddy.y + 0.2 };
    hgoal = { x: t.x, y: t.y };
    bgoal = Math.random() < 0.7
      ? { x: hgoal.x + (Math.random() - 0.5), y: hgoal.y + (Math.random() - 0.5) }
      : { x: 0.5 + Math.random() * (s.width - 1), y: 0.5 + Math.random() * (s.height - 1) };
    if (now - lastCare > 30000) {
      const l = snap.lifecycle;
      const action = l.hunger < 58 ? "feed" : l.energy < 45 ? "nap" : l.happiness < 58 ? "play" : l.affection < 58 ? "pet" : l.mess >= 3 ? "clean" : null;
      if (action) {
        lastCare = now;
        setTimeout(() => { if (root && s.mode === "idle") void brain.care(action); }, 2000);
      }
    }
  }

  function update(dt, now) {
    let hm = { dx: 0, dy: 0 };
    let bm = { dx: 0, dy: 0 };
    if (s.mode === "play") {
      const dx = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
      const dy = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
      hm = move(s.human, dx, dy, 0.0023, dt);
      const bx = s.human.x - s.buddy.x;
      const by = s.human.y - s.buddy.y;
      if (Math.hypot(bx, by) > 1.25) bm = move(s.buddy, bx, by, 0.00165, dt);
    } else {
      void plan(now);
      if (hgoal) {
        const dx = hgoal.x - s.human.x;
        const dy = hgoal.y - s.human.y;
        if (Math.hypot(dx, dy) > 0.18) hm = move(s.human, dx, dy, 0.00115, dt);
      }
      if (bgoal) {
        const dx = bgoal.x - s.buddy.x;
        const dy = bgoal.y - s.buddy.y;
        if (Math.hypot(dx, dy) > 0.18) bm = move(s.buddy, dx, dy, 0.00105, dt);
      }
    }
    if (Math.hypot(hm.dx, hm.dy) > 0.001) hdir = direction(hm.dx, hm.dy, hdir);
    if (Math.hypot(bm.dx, bm.dy) > 0.001) bdir = direction(bm.dx, bm.dy, bdir);
  }

  function draw(now) {
    if (!c || !canvas || !art) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#24342c";
    c.fillRect(0, 0, canvas.width, canvas.height);
    const o = origin();

    for (let y = 0; y < s.height; y += 1) {
      for (let x = 0; x < s.width; x += 1) {
        const floor = s.floors[key(x, y)];
        if (floor && art.floors[floor]) drawFloor(c, art.floors[floor], iso(o, x, y));
      }
    }

    for (let x = 0; x < s.width; x += 1) if (s.floors[key(x, 0)]) drawWall(c, art.wallLeft, iso(o, x, 0));
    for (let y = 0; y < s.height; y += 1) if (s.floors[key(0, y)]) drawWall(c, art.wallRight, iso(o, 0, y));
    for (const wallKey of Object.keys(s.walls)) {
      if (!s.walls[wallKey]) continue;
      const [x, y] = wallKey.split(",").map(Number);
      drawWall(c, (x + y) % 2 === 1 ? art.wallLeft : art.wallRight, iso(o, x, y));
    }

    const actors = s.furniture.map((item) => ({ kind: "f", z: item.x + item.y, item, p: iso(o, item.x, item.y) }));
    actors.push(
      { kind: "h", z: s.human.x + s.human.y, p: iso(o, s.human.x, s.human.y) },
      { kind: "b", z: s.buddy.x + s.buddy.y, p: iso(o, s.buddy.x, s.buddy.y) },
    );
    actors.sort((a, b) => a.z - b.z);

    for (const actor of actors) {
      if (actor.kind === "f") {
        const asset = art.furniture[actor.item.type];
        if (asset) drawFurniture(c, asset, actor.p);
      } else if (actor.kind === "h") {
        petRuntime.drawRuntime(humanRuntime, c, keys.size || s.mode === "idle" ? "running" : "idle", hdir, now, actor.p.x, actor.p.y + TH / 2, 0.72);
      } else {
        const pack = petRuntime.activePack();
        if (pack) {
          const baseScale = pack.frameHeight > 100 ? 0.48 : 0.72;
          petRuntime.drawActive(c, "idle", bdir, now, actor.p.x, actor.p.y + TH / 2, baseScale * petRuntime.scaleMultiplier());
        } else {
          const legacy = shadowRoot.getElementById("birb");
          if (legacy) {
            const birdScale = petRuntime.scaleMultiplier();
            const size = 44 * birdScale;
            c.drawImage(legacy, Math.round(actor.p.x - size / 2), Math.round(actor.p.y + TH / 2 - size), Math.round(size), Math.round(size));
          }
        }
      }
    }

    const snap = brain.snapshot();
    const status = root.querySelector("#pb-status");
    if (status) status.textContent = `${s.mode.toUpperCase()} • ${snap.displayName}: ${snap.mood} • food ${Math.round(snap.lifecycle.hunger)} • energy ${Math.round(snap.lifecycle.energy)} • fun ${Math.round(snap.lifecycle.happiness)} • bond ${Math.round(snap.lifecycle.affection)} • ${art.displayName} verified`;
  }

  function loop(now) {
    if (!root || !root.classList.contains("pb-home")) return;
    const dt = Math.min(50, now - last);
    last = now;
    update(dt, now);
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  return {
    open,
    close,
    isOpen: () => Boolean(root),
    async reloadHuman() {
      const id = await petLibrary.homeHumanId();
      humanRuntime = id ? await petRuntime.runtimeFor(id) : null;
    },
  };
}
