const STATE_PREFIX = "pocket-buddy.";
const ASSET_DB = "pocket-buddy-assets";
const ASSET_STORE = "archives";
const CHUNK_SIZE = 480_000;

function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome?.storage?.local;
}

function hasGmStorage() {
  return typeof GM_getValue === "function" && typeof GM_setValue === "function";
}

function chromeGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result ?? {});
    });
  });
}

function chromeSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function chromeRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function openAssetDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this host."));
      return;
    }
    const request = indexedDB.open(ASSET_DB, 1);
    request.onerror = () => reject(request.error ?? new Error("Pocket Buddy asset database failed to open."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGet(key) {
  const db = await openAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readonly");
      const request = tx.objectStore(ASSET_STORE).get(key);
      request.onerror = () => reject(request.error ?? new Error("Pocket Buddy asset read failed."));
      request.onsuccess = () => resolve(request.result ?? null);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key, value) {
  const db = await openAssetDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("Pocket Buddy asset write failed."));
      tx.oncomplete = () => resolve();
      tx.objectStore(ASSET_STORE).put(value, key);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key) {
  const db = await openAssetDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("Pocket Buddy asset delete failed."));
      tx.oncomplete = () => resolve();
      tx.objectStore(ASSET_STORE).delete(key);
    });
  } finally {
    db.close();
  }
}

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function getJson(key, fallback = null) {
  const namespaced = `${STATE_PREFIX}${key}`;
  if (hasChromeStorage()) {
    const result = await chromeGet([namespaced]);
    return result[namespaced] ?? fallback;
  }
  if (hasGmStorage()) {
    const value = await Promise.resolve(GM_getValue(namespaced, fallback));
    return safeJsonParse(value, fallback);
  }
  try {
    return safeJsonParse(localStorage.getItem(namespaced), fallback);
  } catch {
    return fallback;
  }
}

async function setJson(key, value) {
  const namespaced = `${STATE_PREFIX}${key}`;
  if (hasChromeStorage()) {
    await chromeSet({ [namespaced]: value });
    return;
  }
  if (hasGmStorage()) {
    await Promise.resolve(GM_setValue(namespaced, value));
    return;
  }
  localStorage.setItem(namespaced, JSON.stringify(value));
}

async function removeJson(key) {
  const namespaced = `${STATE_PREFIX}${key}`;
  if (hasChromeStorage()) {
    await chromeRemove([namespaced]);
    return;
  }
  if (hasGmStorage() && typeof GM_deleteValue === "function") {
    await Promise.resolve(GM_deleteValue(namespaced));
    return;
  }
  try { localStorage.removeItem(namespaced); } catch {}
}

async function readChunked(storeKey, getValues) {
  const metaKey = `${storeKey}.meta`;
  const metaResult = await getValues([metaKey]);
  const meta = metaResult[metaKey];
  if (!meta || !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > 2048) return null;
  const chunkKeys = Array.from({ length: meta.chunks }, (_, index) => `${storeKey}.${index}`);
  const chunks = await getValues(chunkKeys);
  const base64 = chunkKeys.map((key) => typeof chunks[key] === "string" ? chunks[key] : "").join("");
  if (!base64) return null;
  const bytes = base64ToBytes(base64);
  if (Number.isFinite(meta.bytes) && bytes.byteLength !== meta.bytes) throw new Error("Pocket Buddy archive storage is incomplete.");
  return bytes.buffer;
}

async function writeChunked(storeKey, buffer, setValues, removeValues) {
  const bytes = new Uint8Array(buffer);
  const base64 = bytesToBase64(bytes);
  const chunks = [];
  for (let offset = 0; offset < base64.length; offset += CHUNK_SIZE) chunks.push(base64.slice(offset, offset + CHUNK_SIZE));
  const old = await readChunkMeta(storeKey, async (keys) => {
    if (hasChromeStorage()) return chromeGet(keys);
    const result = {};
    for (const key of keys) result[key] = await Promise.resolve(GM_getValue(key, null));
    return result;
  });
  if (old?.chunks) {
    const stale = Array.from({ length: old.chunks }, (_, index) => `${storeKey}.${index}`);
    await removeValues(stale);
  }
  for (let start = 0; start < chunks.length; start += 8) {
    const batch = {};
    for (let index = start; index < Math.min(chunks.length, start + 8); index += 1) batch[`${storeKey}.${index}`] = chunks[index];
    await setValues(batch);
  }
  await setValues({ [`${storeKey}.meta`]: { chunks: chunks.length, bytes: bytes.byteLength } });
}

async function readChunkMeta(storeKey, getValues) {
  const key = `${storeKey}.meta`;
  const result = await getValues([key]);
  return result[key] ?? null;
}

async function getBinary(key) {
  const storeKey = `${STATE_PREFIX}asset.${key}`;
  if (hasChromeStorage()) return readChunked(storeKey, chromeGet);
  if (hasGmStorage()) {
    return readChunked(storeKey, async (keys) => {
      const result = {};
      for (const item of keys) result[item] = await Promise.resolve(GM_getValue(item, null));
      return result;
    });
  }
  return idbGet(storeKey);
}

async function setBinary(key, buffer) {
  const storeKey = `${STATE_PREFIX}asset.${key}`;
  const normalized = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (hasChromeStorage()) {
    await writeChunked(storeKey, normalized, chromeSet, chromeRemove);
    return;
  }
  if (hasGmStorage()) {
    await writeChunked(
      storeKey,
      normalized,
      async (values) => { for (const [item, value] of Object.entries(values)) await Promise.resolve(GM_setValue(item, value)); },
      async (keys) => { if (typeof GM_deleteValue === "function") for (const item of keys) await Promise.resolve(GM_deleteValue(item)); },
    );
    return;
  }
  await idbPut(storeKey, normalized);
}

async function removeBinary(key) {
  const storeKey = `${STATE_PREFIX}asset.${key}`;
  if (hasChromeStorage()) {
    const meta = await readChunkMeta(storeKey, chromeGet);
    const keys = [`${storeKey}.meta`, ...Array.from({ length: meta?.chunks ?? 0 }, (_, index) => `${storeKey}.${index}`)];
    await chromeRemove(keys);
    return;
  }
  if (hasGmStorage()) {
    const meta = await readChunkMeta(storeKey, async (keys) => {
      const result = {};
      for (const item of keys) result[item] = await Promise.resolve(GM_getValue(item, null));
      return result;
    });
    if (typeof GM_deleteValue === "function") {
      for (const item of [`${storeKey}.meta`, ...Array.from({ length: meta?.chunks ?? 0 }, (_, index) => `${storeKey}.${index}`)]) await Promise.resolve(GM_deleteValue(item));
    }
    return;
  }
  await idbDelete(storeKey);
}

export function createBuddyStorage() {
  return { getJson, setJson, removeJson, getBinary, setBinary, removeBinary };
}
