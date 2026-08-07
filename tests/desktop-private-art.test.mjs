import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
const builder = await readFile(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8");

test("desktop private-art bridge is manifest and SHA gated", () => {
  assert.match(main, /pocket-buddy-private-art-bundle-v1/);
  assert.match(main, /private-art-manifest\.json/);
  assert.match(main, /createHash\("sha256"\)/);
  assert.match(main, /Private art integrity failure/);
  assert.match(main, /basename\(value\) !== value/);
  assert.match(main, /pocket-buddy:list-bundled-art/);
  assert.match(main, /pocket-buddy:read-bundled-art/);
});

test("sandbox preload exposes only bounded private-art IPC", () => {
  assert.match(preload, /listBundledArt/);
  assert.match(preload, /readBundledArt/);
  assert.doesNotMatch(preload, /require\(["']node:fs/);
  assert.doesNotMatch(preload, /readFile/);
});

test("desktop renderer auto-installs verified packs and fails visibly", () => {
  assert.match(renderer, /installBundledArt/);
  assert.match(renderer, /buddy\.library\.importFile/);
  assert.match(renderer, /pack\?\.archiveSha256 !== entry\.sha256/);
  assert.match(renderer, /Pocket Buddy art integrity error/);
  assert.match(renderer, /Bundled art was not substituted/);
  assert.match(renderer, /buddy\.home\?\.reloadHuman/);
});

test("native packaging reserves a private-art resource directory", () => {
  assert.match(builder, /extraResources:/);
  assert.match(builder, /from: private-art/);
  assert.match(builder, /to: private-art/);
});
