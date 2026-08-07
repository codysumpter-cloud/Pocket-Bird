import test from "node:test";
import assert from "node:assert/strict";

class FakeStyle {
  constructor() { this.values = new Map(); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
  setProperty(name, value) { this.values.set(name, String(value)); }
}

let observer;
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; observer = this; }
  observe() {}
  disconnect() {}
};
globalThis.document = { documentElement: { style: new FakeStyle() } };

const { UI_THEMES, createThemeController } = await import("../src/buddy/theme.js");

function fixture(savedTheme = "auto") {
  const writes = [];
  const storage = {
    async getJson(key, fallback) { return key === "ui.theme.v1" ? savedTheme : fallback; },
    async setJson(key, value) { writes.push([key, value]); },
  };
  const root = { host: { style: new FakeStyle() } };
  root.host.style.setProperty("--birb-highlight", "#123456");
  root.host.style.setProperty("--birb-background-color", "#ffecda");
  const library = { async activeId() { return "pocket-bird"; }, async listInstalled() { return []; } };
  return { storage, root, library, writes };
}

test("theme catalog keeps Auto first and manual ids unique", () => {
  assert.equal(UI_THEMES[0].id, "auto");
  assert.equal(UI_THEMES[0].label, "Auto (Follow Buddy)");
  assert.equal(new Set(UI_THEMES.map((theme) => theme.id)).size, UI_THEMES.length);
});

test("manual theme overrides UI but returning to Auto restores species color", async () => {
  const { storage, root, library, writes } = fixture();
  const themes = createThemeController({ storage, root, library });
  await themes.start();
  await themes.set("forest");
  assert.equal(root.host.style.getPropertyValue("--birb-highlight"), "#68ad61");
  assert.equal(root.host.style.getPropertyValue("--birb-background-color"), "#eef8e9");

  root.host.style.setProperty("--birb-highlight", "#abcdef");
  observer.callback();
  assert.equal(root.host.style.getPropertyValue("--birb-highlight"), "#68ad61");

  await themes.set("auto");
  assert.equal(root.host.style.getPropertyValue("--birb-highlight"), "#abcdef");
  assert.deepEqual(writes.at(-1), ["ui.theme.v1", "auto"]);
});

test("Auto follows canonical imported Buddy palette", async () => {
  const { storage, root, library } = fixture();
  const themes = createThemeController({ storage, root, library });
  await themes.start();
  await themes.setActiveBuddy("pixellab-green-trex", { id: "pixellab-green-trex" });
  assert.equal(root.host.style.getPropertyValue("--birb-highlight"), "#68a84e");
  assert.equal(root.host.style.getPropertyValue("--birb-background-color"), "#eef8df");
});
