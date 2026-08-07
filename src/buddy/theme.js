const THEME_KEY = "ui.theme.v1";
const CLASSIC_BACKGROUND = "#ffecda";
const CLASSIC_ACCENT = "#ffa3cb";

export const UI_THEMES = Object.freeze([
  { id: "auto", label: "Auto (Follow Buddy)", description: "Use the selected Pocket Bird species or active Buddy's preferred colors." },
  { id: "blossom", label: "Blossom", accent: "#ffa3cb", background: "#ffecda" },
  { id: "sky", label: "Sky", accent: "#6ab7ff", background: "#edf7ff" },
  { id: "forest", label: "Forest", accent: "#68ad61", background: "#eef8e9" },
  { id: "ember", label: "Ember", accent: "#eb8a46", background: "#fff0df" },
  { id: "violet", label: "Violet", accent: "#9d83e8", background: "#f3efff" },
  { id: "ocean", label: "Ocean", accent: "#54bfc6", background: "#e9fbfb" },
  { id: "mono", label: "Mono", accent: "#747b88", background: "#f1f3f6" },
]);

const BUDDY_THEMES = Object.freeze({
  "pixellab-balinese-cat": { accent: "#8f76b8", background: "#f4efff" },
  "pixellab-shiba-inu": { accent: "#dc8a42", background: "#fff1df" },
  "pixellab-green-trex": { accent: "#68a84e", background: "#eef8df" },
});

const GENERATED_THEMES = Object.freeze([
  { accent: "#5aa9d6", background: "#edf8ff" },
  { accent: "#d17aa6", background: "#fff0f7" },
  { accent: "#72a85f", background: "#f0f8e9" },
  { accent: "#c88a4f", background: "#fff3e5" },
  { accent: "#8d7bc5", background: "#f4f0ff" },
  { accent: "#53aaa5", background: "#eafaf8" },
]);

function validHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function readPackTheme(pack) {
  if (!pack || typeof pack !== "object") return null;
  const candidate = pack.theme && typeof pack.theme === "object" ? pack.theme : pack;
  const accent = candidate.accent ?? candidate.accentColor ?? candidate.highlightColor;
  const background = candidate.background ?? candidate.backgroundColor;
  if (!validHex(accent)) return null;
  return { accent: accent.trim(), background: validHex(background) ? background.trim() : CLASSIC_BACKGROUND };
}

function hashIndex(value, length) {
  let hash = 2166136261;
  for (const char of String(value ?? "buddy")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

function autoThemeForPack(pack) {
  if (!pack || pack.id === "pocket-bird") return null;
  return readPackTheme(pack) ?? BUDDY_THEMES[pack.id] ?? GENERATED_THEMES[hashIndex(pack.id, GENERATED_THEMES.length)];
}

function setCss(root, accent, background) {
  if (!root?.host) return;
  if (root.host.style.getPropertyValue("--birb-highlight") !== accent) root.host.style.setProperty("--birb-highlight", accent);
  if (root.host.style.getPropertyValue("--birb-background-color") !== background) root.host.style.setProperty("--birb-background-color", background);
  if (document.documentElement.style.getPropertyValue("--birb-highlight") !== accent) document.documentElement.style.setProperty("--birb-highlight", accent);
  if (document.documentElement.style.getPropertyValue("--birb-background-color") !== background) document.documentElement.style.setProperty("--birb-background-color", background);
}

export function createThemeController({ storage, root, library }) {
  let themeId = "auto";
  let activeId = "pocket-bird";
  let activePack = null;
  let baseSpeciesAccent = root?.host?.style.getPropertyValue("--birb-highlight") || CLASSIC_ACCENT;
  let baseSpeciesBackground = root?.host?.style.getPropertyValue("--birb-background-color") || CLASSIC_BACKGROUND;

  const preset = () => UI_THEMES.find((theme) => theme.id === themeId) ?? UI_THEMES[0];

  function apply() {
    const selected = preset();
    if (selected.id !== "auto") {
      setCss(root, selected.accent, selected.background);
      return;
    }
    if (activeId === "pocket-bird") {
      setCss(root, baseSpeciesAccent || CLASSIC_ACCENT, baseSpeciesBackground || CLASSIC_BACKGROUND);
      return;
    }
    const automatic = autoThemeForPack(activePack);
    if (automatic) setCss(root, automatic.accent, automatic.background);
  }

  const observer = new MutationObserver(() => {
    const accent = root.host.style.getPropertyValue("--birb-highlight");
    const background = root.host.style.getPropertyValue("--birb-background-color");
    const selected = preset();
    if (activeId === "pocket-bird") {
      if (selected.id === "auto") {
        if (accent) baseSpeciesAccent = accent;
        if (background) baseSpeciesBackground = background;
        return;
      }
      if (accent && accent !== selected.accent) baseSpeciesAccent = accent;
      if (background && background !== selected.background) baseSpeciesBackground = background;
    }
    apply();
  });

  return {
    async start() {
      const saved = await storage.getJson(THEME_KEY, "auto");
      themeId = UI_THEMES.some((theme) => theme.id === saved) ? saved : "auto";
      activeId = await library.activeId();
      if (activeId !== "pocket-bird") activePack = (await library.listInstalled()).find((pack) => pack.id === activeId) ?? null;
      observer.observe(root.host, { attributes: true, attributeFilter: ["style"] });
      apply();
      return this.snapshot();
    },
    snapshot() {
      const selected = preset();
      return { id: selected.id, label: selected.label, automatic: selected.id === "auto", activeId };
    },
    themes() { return UI_THEMES.map((theme) => ({ ...theme })); },
    async set(id) {
      themeId = UI_THEMES.some((theme) => theme.id === id) ? id : "auto";
      await storage.setJson(THEME_KEY, themeId);
      apply();
      return this.snapshot();
    },
    async setActiveBuddy(id, pack = null) {
      activeId = id || "pocket-bird";
      activePack = activeId === "pocket-bird" ? null : pack;
      apply();
      return this.snapshot();
    },
    refresh() { apply(); return this.snapshot(); },
    destroy() { observer.disconnect(); },
  };
}
