import { openZipArchive, findMetadataRoot, pngDimensions, sha256Hex } from "./zip.js";
import {
  CANONICAL_DIRECTIONS, PRISMTEK_PACK_RECIPES, recipeByArchiveName, recipeByHash,
  normalizeAnimationId, humanizeAnimationName, inferSemanticTags, inferDurationMs, inferSemanticDefaults,
} from "./pet-recipes.js";

const INSTALLED_KEY = "pets.installed.v1";
const ACTIVE_KEY = "pets.active.v1";
const HUMAN_KEY = "home.human.v1";
const PET_ID = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeText(value, fallback = "", maximum = 500) { return (typeof value === "string" ? value.trim() : "" || fallback).slice(0, maximum); }
function resolveArchivePath(zip, root, path) {
  if (typeof path !== "string" || !path) throw new Error("Pet manifest references an invalid asset path.");
  if (zip.paths.has(path)) return path;
  const rooted = root ? `${root}/${path}` : path;
  if (zip.paths.has(rooted)) return rooted;
  throw new Error(`Pet archive is missing referenced asset: ${path}`);
}
function uniqueId(base, identity, used) {
  let id = normalizeAnimationId(base), suffix = 1;
  while (used.has(id) && used.get(id) !== identity) id = `${normalizeAnimationId(base).slice(0, 112)}-${suffix++}`;
  used.set(id, identity); return id;
}
function frameIndex(path) {
  const match = String(path).match(/(?:^|\/)frame_(\d+)\.png$/i);
  return match ? Number(match[1]) : null;
}
function indexesComplete(paths) {
  const indexes = paths.map(frameIndex).filter((value) => Number.isInteger(value));
  if (!indexes.length) return true;
  const set = new Set(indexes), max = Math.max(...indexes);
  for (let index = 0; index <= max; index += 1) if (!set.has(index)) return false;
  return true;
}

async function validateFrameSet(zip, paths, width, height) {
  for (const path of paths) {
    const bytes = await zip.read(path), size = pngDimensions(bytes);
    if (size.width !== width || size.height !== height) throw new Error(`Frame ${path} is ${size.width}×${size.height}; expected ${width}×${height}.`);
  }
}

function resolveRequestedAnimation(requested, animations) {
  if (!requested) return undefined;
  return animations.find((animation) => animation.originalName === requested || animation.id === requested)?.id;
}

async function importPixelLab(file, arrayBuffer, storage, zip, hash) {
  const root = findMetadataRoot(zip.paths), metadataPath = root ? `${root}/metadata.json` : "metadata.json";
  const metadata = JSON.parse(await zip.readText(metadataPath, 2 * 1024 * 1024));
  if (!isRecord(metadata) || metadata.export_version !== "3.1" || !Array.isArray(metadata.states) || metadata.states.length < 1) throw new Error("This is not a supported PixelLab export 3.1 archive.");

  const byName = recipeByArchiveName(file.name), byHash = recipeByHash(hash);
  if (byName && hash !== byName.sha256) throw new Error(`${file.name} does not match the canonical ${byName.displayName} SHA-256.`);
  if (byHash && file.name !== byHash.archiveName) throw new Error(`Canonical ${byHash.displayName} must be imported as ${byHash.archiveName}.`);
  const recipe = byName ?? byHash;
  const selectedStates = (metadata.states ?? []).filter((state) => {
    if (!isRecord(state) || typeof state.folder !== "string") return false;
    return !recipe?.includeStates || recipe.includeStates.includes(state.folder);
  });
  if (!selectedStates.length) throw new Error("PixelLab archive contains no selected states.");

  const firstCharacter = selectedStates.map((state) => state.character).find((character) => isRecord(character) && isRecord(character.size));
  const width = Number(firstCharacter?.size?.width), height = Number(firstCharacter?.size?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 512 || height > 512) throw new Error("PixelLab archive has invalid native frame dimensions.");
  if (recipe && (width !== recipe.width || height !== recipe.height)) throw new Error(`${recipe.displayName} is ${width}×${height}; expected ${recipe.width}×${recipe.height}.`);

  const animations = [], used = new Map();
  for (const state of selectedStates) {
    const stateName = state.folder, rotations = state.frames?.rotations ?? {};
    if (isRecord(rotations) && Object.keys(rotations).length) {
      const originalName = `[state] ${stateName}`, id = uniqueId(`state-${stateName}`, `${stateName}:rotations`, used), frames = {};
      for (const direction of CANONICAL_DIRECTIONS) {
        const rawPath = rotations[direction]; if (typeof rawPath !== "string") continue;
        frames[direction] = [resolveArchivePath(zip, root, rawPath)];
      }
      const directions = CANONICAL_DIRECTIONS.filter((direction) => frames[direction]?.length);
      animations.push({ id, originalName, label: humanizeAnimationName(stateName), state: stateName, frames, directions, durationMs: 1000, iterations: "infinite", loopMode: "loop", semanticTags: ["state", "pose"], complete: directions.length === 8 });
    }
    const sourceAnimations = state.frames?.animations ?? {};
    if (!isRecord(sourceAnimations)) continue;
    for (const [originalName, directionFrames] of Object.entries(sourceAnimations)) {
      if (!isRecord(directionFrames)) continue;
      const id = uniqueId(originalName, `${stateName}:${originalName}`, used), frames = {};
      for (const direction of CANONICAL_DIRECTIONS) {
        const rawPaths = directionFrames[direction]; if (!Array.isArray(rawPaths)) continue;
        const paths = rawPaths.filter((path) => typeof path === "string").map((path) => resolveArchivePath(zip, root, path));
        if (paths.length) frames[direction] = paths;
      }
      const directions = CANONICAL_DIRECTIONS.filter((direction) => frames[direction]?.length);
      const complete = directions.length === 8 && directions.every((direction) => indexesComplete(frames[direction]));
      animations.push({
        id, originalName, label: humanizeAnimationName(originalName), state: stateName, frames, directions,
        durationMs: inferDurationMs(originalName), iterations: /jump|roll|punch|death|fall|wince|lunge|bark|wave/i.test(originalName) ? 1 : "infinite",
        loopMode: /jump|roll|punch|death|fall|wince|lunge|bark|wave/i.test(originalName) ? "recover" : "loop",
        semanticTags: inferSemanticTags(originalName, stateName), complete,
      });
    }
  }
  if (!animations.length) throw new Error("PixelLab archive contains no importable animations.");

  const uniqueFrames = new Set();
  for (const animation of animations) for (const paths of Object.values(animation.frames)) for (const path of paths) uniqueFrames.add(path);
  await validateFrameSet(zip, [...uniqueFrames], width, height);

  const inferred = inferSemanticDefaults(animations), semanticDefaults = { ...inferred };
  for (const [semantic, requested] of Object.entries(recipe?.semanticDefaults ?? {})) {
    const resolved = resolveRequestedAnimation(requested, animations);
    if (resolved && animations.find((animation) => animation.id === resolved)?.complete) semanticDefaults[semantic] = resolved;
  }
  const idleId = semanticDefaults.idle ?? animations.find((animation) => animation.complete)?.id ?? animations[0].id;
  const idle = animations.find((animation) => animation.id === idleId) ?? animations[0];
  const previewDirection = idle.frames.south?.length ? "south" : idle.directions[0];
  const previewPath = idle.frames[previewDirection]?.[0];
  if (!previewPath) throw new Error("PixelLab pet has no preview frame.");

  const archiveLabel = file.name.replace(/\.zip$/i, "").replace(/-2$/i, "").replace(/[_-]+/g, " ").trim();
  const rawCharacterName = safeText(selectedStates.map((item) => item.character?.name).find((name) => typeof name === "string" && name.trim()), "", 80);
  const genericNames = new Set(["idle", "adult", "baby", "adolescent", "default", "main", "sitting", "sleeping"]);
  const displayName = recipe?.displayName ?? (rawCharacterName && !genericNames.has(rawCharacterName.toLowerCase()) ? rawCharacterName : archiveLabel || "Imported Buddy");
  const id = recipe?.id ?? `pixellab-${normalizeAnimationId(displayName).slice(0, 48)}`;
  const pack = {
    version: 1, id, displayName, description: recipe ? `Prismtek canonical PixelLab Buddy: ${displayName}.` : `Imported PixelLab Buddy from ${file.name}.`,
    kind: recipe?.kind ?? "buddy", source: "pixellab", archiveName: file.name, archiveSha256: hash, frameWidth: width, frameHeight: height,
    animations, semanticDefaults, previewPath, previewDirection, importedAt: new Date().toISOString(), canonical: Boolean(recipe),
  };
  await storage.setBinary(`pet.${id}`, arrayBuffer);
  await upsertInstalled(storage, pack);
  if (pack.kind === "human") await storage.setJson(HUMAN_KEY, id);
  return pack;
}

async function imageDimensions(bytes, mime = "image/webp") {
  const blob = new Blob([bytes], { type: mime });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => { const result = { width: image.naturalWidth, height: image.naturalHeight }; URL.revokeObjectURL(url); resolve(result); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Pet spritesheet could not be decoded.")); };
    image.src = url;
  });
}

async function importOpenPets(file, arrayBuffer, storage, zip, hash) {
  const petPaths = [...zip.paths].filter((path) => path === "pet.json" || path.endsWith("/pet.json"));
  if (petPaths.length !== 1) throw new Error("OpenPets package must contain exactly one pet.json.");
  const petPath = petPaths[0], root = petPath === "pet.json" ? "" : petPath.slice(0, -"/pet.json".length);
  const metadata = JSON.parse(await zip.readText(petPath, 128 * 1024));
  if (!isRecord(metadata) || !PET_ID.test(metadata.id) || metadata.id === "builtin") throw new Error("OpenPets pet.json has an invalid pet id.");
  const displayName = safeText(metadata.displayName, "", 120), description = safeText(metadata.description, "", 500);
  if (!displayName || !description) throw new Error("OpenPets pet.json is missing displayName or description.");
  const sheetPath = resolveArchivePath(zip, root, safeText(metadata.spritesheetPath, "spritesheet.webp", 240));
  const sheet = await zip.read(sheetPath);
  if (sheet.byteLength < 16 || String.fromCharCode(...sheet.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...sheet.subarray(8, 12)) !== "WEBP") throw new Error("OpenPets spritesheet is not a WebP image.");
  const dimensions = await imageDimensions(sheet);
  const frameWidth = 192, frameHeight = 208, columns = 8, rows = 9;
  if (dimensions.width < frameWidth * columns || dimensions.height < frameHeight * rows) throw new Error(`OpenPets spritesheet is ${dimensions.width}×${dimensions.height}; expected at least ${frameWidth * columns}×${frameHeight * rows}.`);
  const pack = {
    version: 1, id: metadata.id, displayName, description, kind: "buddy", source: "openpets", archiveName: file.name, archiveSha256: hash,
    frameWidth, frameHeight, sheetPath, columns, rows, importedAt: new Date().toISOString(), canonical: false,
    standardStates: {
      idle: { row: 0, frames: 6, durationMs: 5500, iterations: "infinite" }, "running-right": { row: 1, frames: 8, durationMs: 1060 },
      "running-left": { row: 2, frames: 8, durationMs: 1060 }, waving: { row: 3, frames: 4, durationMs: 700, iterations: 2 },
      jumping: { row: 4, frames: 5, durationMs: 840, iterations: 2 }, failed: { row: 5, frames: 8, durationMs: 1220, iterations: 2 },
      waiting: { row: 6, frames: 6, durationMs: 1010 }, running: { row: 7, frames: 6, durationMs: 820 }, review: { row: 8, frames: 6, durationMs: 1030 },
    },
    semanticDefaults: { idle: "idle", running: "running", review: "review", waiting: "waiting", waving: "waving", jumping: "jumping", failed: "failed" },
    previewPath: sheetPath,
  };
  await storage.setBinary(`pet.${pack.id}`, arrayBuffer); await upsertInstalled(storage, pack); return pack;
}

async function upsertInstalled(storage, pack) {
  const current = await storage.getJson(INSTALLED_KEY, []), list = Array.isArray(current) ? current.filter((item) => isRecord(item) && item.id !== pack.id) : [];
  list.push(pack); await storage.setJson(INSTALLED_KEY, list.slice(-120));
}

export function createPetLibrary(storage) {
  return {
    async listInstalled() { const value = await storage.getJson(INSTALLED_KEY, []); return Array.isArray(value) ? value : []; },
    async activeId() { return await storage.getJson(ACTIVE_KEY, "pocket-bird"); },
    async setActive(id) { await storage.setJson(ACTIVE_KEY, id || "pocket-bird"); },
    async homeHumanId() { return await storage.getJson(HUMAN_KEY, null); },
    async setHomeHuman(id) { await storage.setJson(HUMAN_KEY, id ?? null); },
    canonicalSlots() { return PRISMTEK_PACK_RECIPES.map((recipe) => ({ ...recipe })); },
    async importFile(file) {
      if (!(file instanceof Blob) || typeof file.name !== "string") throw new Error("Choose a ZIP pet package.");
      if (!/\.zip$/i.test(file.name)) throw new Error("Pocket Buddy imports ZIP pet packages.");
      if (file.size <= 0 || file.size > 250 * 1024 * 1024) throw new Error("Pet ZIP is empty or too large.");
      const arrayBuffer = await file.arrayBuffer(), hash = await sha256Hex(arrayBuffer), zip = await openZipArchive(arrayBuffer);
      const paths = [...zip.paths];
      if (paths.some((path) => path === "metadata.json" || path.endsWith("/metadata.json"))) return importPixelLab(file, arrayBuffer, storage, zip, hash);
      if (paths.some((path) => path === "pet.json" || path.endsWith("/pet.json"))) return importOpenPets(file, arrayBuffer, storage, zip, hash);
      throw new Error("ZIP is neither a PixelLab 3.1 export nor an OpenPets pet package.");
    },
    async loadRuntime(id) {
      if (!id || id === "pocket-bird") return null;
      const installed = await this.listInstalled(), pack = installed.find((item) => item.id === id);
      if (!pack) return null;
      const arrayBuffer = await storage.getBinary(`pet.${id}`); if (!arrayBuffer) return null;
      const zip = await openZipArchive(arrayBuffer); return { pack, zip };
    },
    async uninstall(id) {
      const list = (await this.listInstalled()).filter((item) => item.id !== id); await storage.setJson(INSTALLED_KEY, list); await storage.removeBinary(`pet.${id}`);
      if (await this.activeId() === id) await this.setActive("pocket-bird"); if (await this.homeHumanId() === id) await this.setHomeHuman(null);
    },
  };
}
