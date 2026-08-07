const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 750 * 1024 * 1024;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }

function safePath(path) {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0")) throw new Error(`Unsafe ZIP path: ${path || "<empty>"}`);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`Unsafe ZIP path: ${path}`);
  return parts.join("/");
}

function findEocd(view) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("ZIP end-of-central-directory record was not found.");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("This browser cannot decompress ZIP files yet.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function utf8(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pngDimensions(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) throw new Error("Frame is not a PNG.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

export function findMetadataRoot(paths) {
  const candidates = [...paths].filter((path) => path === "metadata.json" || path.endsWith("/metadata.json"));
  if (candidates.length !== 1) throw new Error(candidates.length ? "ZIP has more than one metadata.json." : "ZIP is missing metadata.json.");
  return candidates[0] === "metadata.json" ? "" : candidates[0].slice(0, -"/metadata.json".length);
}

export async function openZipArchive(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error("ZIP input must be an ArrayBuffer.");
  if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("ZIP is empty or too large.");
  const view = new DataView(arrayBuffer), eocd = findEocd(view);
  const disk = u16(view, eocd + 4), centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8), entryCount = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12), centralOffset = u32(view, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("Multi-disk ZIP archives are not supported.");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported.");
  if (entryCount > MAX_ENTRIES) throw new Error("ZIP contains too many files.");
  if (centralOffset + centralSize > arrayBuffer.byteLength) throw new Error("ZIP central directory is outside the archive.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const byName = new Map(), folded = new Set();
  let cursor = centralOffset, extractedTotal = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > arrayBuffer.byteLength || u32(view, cursor) !== CENTRAL_SIGNATURE) throw new Error("ZIP central directory is malformed.");
    const flags = u16(view, cursor + 8), method = u16(view, cursor + 10), crc32 = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20), uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), commentLength = u16(view, cursor + 32), localOffset = u32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > arrayBuffer.byteLength) throw new Error("ZIP central directory entry is truncated.");
    if ((flags & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method: ${method}.`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("ZIP entry is too large.");
    extractedTotal += uncompressedSize;
    if (extractedTotal > MAX_EXTRACTED_BYTES) throw new Error("ZIP extracted size is too large.");
    const rawName = new Uint8Array(arrayBuffer, cursor + 46, nameLength);
    const name = decoder.decode(rawName);
    if (!name.endsWith("/")) {
      const normalized = safePath(name), fold = normalized.toLocaleLowerCase("en-US");
      if (byName.has(normalized) || folded.has(fold)) throw new Error(`ZIP contains duplicate or case-colliding path: ${normalized}`);
      byName.set(normalized, { name: normalized, method, flags, crc32, compressedSize, uncompressedSize, localOffset });
      folded.add(fold);
    }
    cursor = end;
  }

  async function read(name) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`ZIP entry is missing: ${name}`);
    const offset = entry.localOffset;
    if (offset + 30 > arrayBuffer.byteLength || u32(view, offset) !== LOCAL_SIGNATURE) throw new Error(`ZIP local header is malformed: ${name}`);
    const localFlags = u16(view, offset + 6), localMethod = u16(view, offset + 8), nameLength = u16(view, offset + 26), extraLength = u16(view, offset + 28);
    if ((localFlags & 0x1) !== 0 || localMethod !== entry.method) throw new Error(`ZIP local header disagrees with central directory: ${name}`);
    const dataStart = offset + 30 + nameLength + extraLength, dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > arrayBuffer.byteLength) throw new Error(`ZIP entry is truncated: ${name}`);
    const compressed = new Uint8Array(arrayBuffer, dataStart, entry.compressedSize);
    const result = entry.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed);
    if (result.byteLength !== entry.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${name}`);
    return result;
  }

  async function readText(name, maximum = 1024 * 1024) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`ZIP entry is missing: ${name}`);
    if (entry.uncompressedSize > maximum) throw new Error(`ZIP text entry is too large: ${name}`);
    return utf8(await read(name));
  }

  return { paths: new Set(byName.keys()), entries: byName, read, readText, bytes: arrayBuffer.byteLength };
}
