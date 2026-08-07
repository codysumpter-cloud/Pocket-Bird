const MOTION_EPSILON = 0.35;

function directionFromVector(dx, dy, fallback = "south") {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < MOTION_EPSILON) return fallback;
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][octant] ?? fallback;
}
function firstDirection(frames = {}) { return ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"].find((direction) => frames[direction]?.length); }
function frameIndex(durationMs, count, now) { return count <= 1 ? 0 : Math.floor((now % Math.max(1, durationMs)) / Math.max(1, durationMs / count)) % count; }

export function createPetRuntime(library, shadowRoot) {
  const imageCache = new Map();
  const pending = new Map();
  let active = null, base = null, overlay = null, overlayCtx = null, raf = 0, lastCenter = null, lastMovedAt = 0, lastDirection = "south", forcedSemantic = null, forcedUntil = 0;

  async function imageFor(runtime, path, mime = "image/png") {
    const key = `${runtime.pack.id}:${path}`;
    if (imageCache.has(key)) return imageCache.get(key);
    if (pending.has(key)) return null;
    pending.set(key, true);
    try {
      const bytes = await runtime.zip.read(path), blob = new Blob([bytes], { type: mime });
      let drawable;
      if (typeof createImageBitmap === "function") drawable = await createImageBitmap(blob);
      else drawable = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob), image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not decode ${path}`)); }; image.src = url;
      });
      imageCache.set(key, drawable); return drawable;
    } catch (error) {
      console.warn("Pocket Buddy: pet frame decode failed", error); return null;
    } finally { pending.delete(key); }
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("canvas"); overlay.id = "pocket-buddy-custom-pet";
    overlay.style.cssText = "position:fixed;left:0;top:0;z-index:2147483638;pointer-events:none;image-rendering:pixelated;transform-origin:bottom center;";
    overlayCtx = overlay.getContext("2d"); overlayCtx.imageSmoothingEnabled = false; shadowRoot.appendChild(overlay);
  }

  async function select(id) {
    if (id === "pocket-bird" || !id) {
      active = null; if (base) base.style.opacity = ""; if (overlay) overlay.style.display = "none"; return;
    }
    active = await library.loadRuntime(id);
    if (!active) { if (base) base.style.opacity = ""; if (overlay) overlay.style.display = "none"; return; }
    ensureOverlay(); overlay.style.display = "block"; if (base) base.style.opacity = "0";
    if (active.pack.source === "openpets") void imageFor(active, active.pack.sheetPath, "image/webp");
  }

  function resolvePixelLabFrame(runtime, semantic, direction, now) {
    const pack = runtime.pack;
    const requested = pack.semanticDefaults?.[semantic] ?? pack.semanticDefaults?.idle;
    const animation = pack.animations?.find((item) => item.id === requested) ?? pack.animations?.find((item) => item.complete) ?? pack.animations?.[0];
    if (!animation) return null;
    const resolvedDirection = animation.frames?.[direction]?.length ? direction : animation.frames?.south?.length ? "south" : firstDirection(animation.frames);
    const paths = animation.frames?.[resolvedDirection] ?? []; if (!paths.length) return null;
    return { path: paths[frameIndex(animation.durationMs ?? 1000, paths.length, now)], mime: "image/png", width: pack.frameWidth, height: pack.frameHeight };
  }

  function resolveOpenPetsFrame(runtime, semantic, direction, now) {
    const pack = runtime.pack;
    let stateId = pack.semanticDefaults?.[semantic] ?? "idle";
    if (semantic === "running") stateId = direction.includes("west") ? "running-left" : direction.includes("east") ? "running-right" : "running";
    const state = pack.standardStates?.[stateId] ?? pack.standardStates?.idle; if (!state) return null;
    const index = frameIndex(state.durationMs ?? 1000, state.frames ?? 1, now);
    return { sheetPath: pack.sheetPath, mime: "image/webp", sx: index * pack.frameWidth, sy: state.row * pack.frameHeight, width: pack.frameWidth, height: pack.frameHeight };
  }

  async function getFrame(runtime, semantic = "idle", direction = "south", now = Date.now()) {
    if (!runtime) return null;
    if (runtime.pack.source === "pixellab") {
      const frame = resolvePixelLabFrame(runtime, semantic, direction, now); if (!frame) return null;
      const image = await imageFor(runtime, frame.path, frame.mime); return image ? { image, sx: 0, sy: 0, sw: frame.width, sh: frame.height } : null;
    }
    const frame = resolveOpenPetsFrame(runtime, semantic, direction, now); if (!frame) return null;
    const image = await imageFor(runtime, frame.sheetPath, frame.mime); return image ? { image, sx: frame.sx, sy: frame.sy, sw: frame.width, sh: frame.height } : null;
  }

  function requestFrame(runtime, semantic, direction, now, callback) {
    void getFrame(runtime, semantic, direction, now).then((frame) => { if (frame) callback(frame); });
  }

  function drawOverlay(now) {
    if (!active || !base || !overlay || !overlayCtx) return;
    const rect = base.getBoundingClientRect(), center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (lastCenter) {
      const dx = center.x - lastCenter.x, dy = center.y - lastCenter.y;
      if (Math.hypot(dx, dy) >= MOTION_EPSILON) { lastDirection = directionFromVector(dx, dy, lastDirection); lastMovedAt = now; }
    }
    lastCenter = center;
    const semantic = forcedSemantic && now < forcedUntil ? forcedSemantic : (now - lastMovedAt < 140 ? "running" : "idle"), pack = active.pack, scale = rect.width / Math.max(1, base.width || 32);
    const width = Math.round(pack.frameWidth * scale), height = Math.round(pack.frameHeight * scale);
    if (overlay.width !== pack.frameWidth || overlay.height !== pack.frameHeight) { overlay.width = pack.frameWidth; overlay.height = pack.frameHeight; overlayCtx.imageSmoothingEnabled = false; }
    overlay.style.width = `${width}px`; overlay.style.height = `${height}px`; overlay.style.left = `${rect.left + rect.width / 2 - width / 2}px`; overlay.style.top = `${rect.bottom - height}px`;
    requestFrame(active, semantic, lastDirection, now, (frame) => {
      if (!active || !overlayCtx) return; overlayCtx.clearRect(0, 0, overlay.width, overlay.height); overlayCtx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, overlay.width, overlay.height);
    });
  }

  function loop(now) { drawOverlay(now); raf = requestAnimationFrame(loop); }

  async function start() {
    base = shadowRoot.getElementById("birb");
    if (!base) return false;
    await select(await library.activeId());
    if (!raf) raf = requestAnimationFrame(loop); return true;
  }

  function drawRuntime(runtime, ctx, semantic, direction, now, x, y, scale = 1) {
    if (!runtime) return;
    requestFrame(runtime, semantic, direction, now, (frame) => {
      const width = runtime.pack.frameWidth * scale, height = runtime.pack.frameHeight * scale;
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, Math.round(x - width / 2), Math.round(y - height), Math.round(width), Math.round(height)); ctx.restore();
    });
  }

  return {
    start, select,
    react(reaction, durationMs = 1500) {
      const semantic = ({ thinking: "review", working: "running", editing: "running", running: "running", testing: "waiting", waiting: "waiting", waving: "waving", success: "jumping", celebrating: "jumping", error: "failed", eating: "eating", idle: "idle" })[reaction] ?? "idle";
      forcedSemantic = semantic; forcedUntil = performance.now() + Math.max(200, durationMs);
    },
    activePack() { return active?.pack ?? null; },
    activeRuntime() { return active; },
    async runtimeFor(id) { return id ? library.loadRuntime(id) : null; },
    drawRuntime,
    drawActive(ctx, semantic, direction, now, x, y, scale = 1) { drawRuntime(active, ctx, semantic, direction, now, x, y, scale); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; if (base) base.style.opacity = ""; overlay?.remove(); overlay = null; },
  };
}
