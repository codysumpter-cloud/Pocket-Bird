import { createBuddyStorage } from "./storage.js";
import { createBuddyBrain } from "./brain.js";
import { createPetLibrary } from "./pet-importer.js";
import { createPetRuntime } from "./pet-runtime.js";
import { createHome } from "./home.js";
import { createThemeController } from "./theme.js";
import { PRISMTEK_PACK_RECIPES, OPENPETS_GALLERY_URL } from "./pet-recipes.js";

const POCKET_BUDDY_VERSION = "__POCKET_BUDDY_VERSION__";
let catalogCache = null;

async function openPetsCatalog() {
  if (catalogCache) return catalogCache;
  try {
    const first = await fetch("https://openpets.dev/pets/catalog.v3.json", { credentials: "omit", cache: "force-cache" });
    if (!first.ok) throw new Error(`catalog ${first.status}`);
    const index = await first.json();
    const all = [];
    const add = (entry) => {
      if (entry && typeof entry.id === "string" && typeof entry.displayName === "string" && !all.some((item) => item.id === entry.id)) all.push(entry);
    };
    (Array.isArray(index?.pets) ? index.pets : Array.isArray(index?.items) ? index.items : []).forEach(add);
    for (const page of Array.isArray(index?.pages) ? index.pages : []) {
      const url = typeof page === "string"
        ? new URL(page, "https://openpets.dev/pets/").href
        : typeof page?.url === "string" ? new URL(page.url, "https://openpets.dev/pets/").href : null;
      if (!url) continue;
      const response = await fetch(url, { credentials: "omit", cache: "force-cache" });
      if (!response.ok) continue;
      const data = await response.json();
      (Array.isArray(data) ? data : Array.isArray(data?.pets) ? data.pets : Array.isArray(data?.items) ? data.items : []).forEach(add);
    }
    catalogCache = all;
    return all;
  } catch (error) {
    console.warn("Pocket Buddy: OpenPets catalog unavailable on this host", error);
    return [];
  }
}

const waitRoot = () => new Promise((resolve, reject) => {
  let attempts = 0;
  const timer = setInterval(() => {
    const host = document.getElementById("birb-shadow-host");
    if (host?.shadowRoot) {
      clearInterval(timer);
      resolve(host.shadowRoot);
    } else if (++attempts > 240) {
      clearInterval(timer);
      reject(new Error("Pocket Bird runtime did not create its shadow root."));
    }
  }, 50);
});

const btn = (label, fn, className = "") => {
  const button = document.createElement("button");
  button.textContent = label;
  button.className = className;
  button.onclick = fn;
  return button;
};

function closeBaseMenu(root) {
  root.getElementById("birb-menu")?.remove();
  root.getElementById("birb-menu-exit")?.remove();
}

function windowBox(root, id, title) {
  root.getElementById(id)?.remove();
  const window = document.createElement("div");
  window.id = id;
  window.className = "birb-window pb-window";
  const header = document.createElement("div");
  header.className = "birb-window-header";
  const heading = document.createElement("div");
  heading.className = "birb-window-title";
  heading.textContent = title;
  const close = document.createElement("div");
  close.className = "birb-window-close";
  close.textContent = "x";
  close.onclick = () => window.remove();
  header.append(heading, close);
  const content = document.createElement("div");
  content.className = "birb-window-content pb-content";
  window.append(header, content);
  root.append(window);
  window.style.left = `${Math.max(8, innerWidth / 2 - window.offsetWidth / 2)}px`;
  window.style.top = `${Math.max(8, innerHeight / 2 - window.offsetHeight / 2)}px`;
  return { w: window, c: content };
}

function toast(root, text) {
  const element = document.createElement("div");
  element.className = "pb-toast";
  element.textContent = text;
  root.append(element);
  setTimeout(() => element.remove(), 2200);
}

function styles(root) {
  if (root.getElementById("pb-layer-style")) return;
  const style = document.createElement("style");
  style.id = "pb-layer-style";
  style.textContent = `
    .pb-window{width:min(420px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 24px))}
    .pb-content{padding:8px;gap:7px;overflow:auto;align-items:stretch}
    .pb-menu-item{width:calc(100% - 4px)}
    .pb-row{display:flex;gap:6px;flex-wrap:wrap}
    .pb-row button,.pb-content button,.pb-content input{font:inherit;border:2px solid var(--birb-border-color);background:var(--birb-background-color);padding:5px;color:#222}
    .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:7px;width:100%}
    .pb-card{border:2px solid var(--birb-highlight);background:color-mix(in srgb,var(--birb-highlight) 18%,var(--birb-background-color));padding:6px;min-height:75px;cursor:pointer}
    .pb-card.locked{opacity:.55;filter:grayscale(1)}
    .pb-card.selected{outline:2px solid var(--birb-border-color);outline-offset:1px}
    .pb-small{font-size:10px;opacity:.72}
    .pb-bar{height:8px;border:1px solid var(--birb-border-color);background:color-mix(in srgb,var(--birb-background-color) 75%,#777)}
    .pb-bar>i{display:block;height:100%;background:var(--birb-highlight)}
    .pb-chat{height:220px;overflow:auto;border:2px solid var(--birb-highlight);background:var(--birb-background-color);padding:6px}
    .pb-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483647;background:var(--birb-background-color);border:2px solid var(--birb-border-color);padding:6px;box-shadow:4px 4px 0 var(--birb-border-color);font:12px Monocraft,monospace}
    .pb-theme-swatch{height:24px;border:1px solid var(--birb-border-color);margin-bottom:5px;display:flex;overflow:hidden}
    .pb-theme-swatch>i{display:block;flex:1}
  `;
  root.append(style);
}

function importButton(root, library, after) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.hidden = true;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const pack = await library.importFile(file);
      toast(root, `${pack.displayName} imported`);
      await after(pack);
    } catch (error) {
      toast(root, error?.message || "Import failed");
    } finally {
      input.value = "";
    }
  };
  root.append(input);
  return btn("Import pet ZIP", () => input.click());
}

function menuItem(label, fn) {
  const element = document.createElement("div");
  element.className = "birb-menu-item pb-menu-item";
  element.textContent = label;
  element.onclick = fn;
  return element;
}

function isSettingsMenu(menu) {
  const first = menu.querySelector(".birb-window-content > .birb-menu-item");
  return first?.textContent?.trim() === "Go Back";
}

export async function initializeBuddyLayer() {
  if (window.PocketBuddy?.coreVersion) return window.PocketBuddy;

  const root = await waitRoot();
  styles(root);
  const storage = createBuddyStorage();
  const library = createPetLibrary(storage);
  let runtime;
  const brain = createBuddyBrain(storage, { onReaction: (reaction) => runtime?.react(reaction) });
  await brain.load();
  runtime = createPetRuntime(library, root);
  await runtime.start();
  const home = createHome({ storage, brain, petRuntime: runtime, petLibrary: library, shadowRoot: root });
  const themes = createThemeController({ storage, root, library });
  await themes.start();

  async function care(action) {
    const result = await brain.care(action);
    if (action === "feed") runtime.react("eating", 1400);
    toast(root, result.message);
    return result;
  }

  function showCare() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-care", "Care");
    const snap = brain.snapshot();
    for (const [key, label] of [["hunger", "Food"], ["energy", "Energy"], ["happiness", "Fun"], ["affection", "Bond"], ["health", "Health"]]) {
      const row = document.createElement("div");
      row.textContent = `${label} ${Math.round(snap.lifecycle[key])}`;
      const bar = document.createElement("div");
      bar.className = "pb-bar";
      bar.innerHTML = `<i style="width:${Math.round(snap.lifecycle[key])}%"></i>`;
      c.append(row, bar);
    }
    const actions = document.createElement("div");
    actions.className = "pb-row";
    for (const [action, label] of [["feed", "Feed"], ["play", "Play"], ["pet", "Pet"], ["nap", "Nap"], ["clean", "Clean"], ["medicine", "Medicine"]]) {
      actions.append(btn(label, () => care(action).then(showCare)));
    }
    c.append(actions);
  }

  function showBrain() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-brain", "Buddy Brain");
    const state = brain.snapshot();
    c.innerHTML = `<b>${state.displayName}</b><div class="pb-small">${state.stage} • level ${state.level} • ${state.mood}</div><div>Personality and relationship memory belong to this Buddy across Pocket Buddy surfaces.</div><div class="pb-small">Trust ${Math.round(state.brain.relationship.trust * 100)} • Familiarity ${Math.round(state.brain.relationship.familiarity * 100)} • Notes ${state.brain.notes.length}</div>`;
    const name = document.createElement("input");
    name.value = state.displayName;
    name.maxLength = 64;
    const note = document.createElement("input");
    note.placeholder = "Remember a note…";
    c.append(
      name,
      btn("Rename", () => brain.rename(name.value).then(() => toast(root, "Buddy renamed"))),
      note,
      btn("Remember", () => brain.addNote(note.value).then(() => { note.value = ""; toast(root, "Remembered"); })),
    );
  }

  function showTalk() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-talk", `Talk to ${brain.snapshot().displayName}`);
    const log = document.createElement("div");
    log.className = "pb-chat";
    for (const message of brain.snapshot().brain.messages.slice(-20)) {
      const line = document.createElement("div");
      line.textContent = `${message.role === "user" ? "You" : "Buddy"}: ${message.text}`;
      log.append(line);
    }
    const row = document.createElement("div");
    row.className = "pb-row";
    const input = document.createElement("input");
    input.placeholder = "Say something…";
    input.style.flex = "1";
    const send = btn("Send", async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await brain.talk(text);
      showTalk();
    });
    input.onkeydown = (event) => { if (event.key === "Enter") send.click(); };
    row.append(input, send);
    c.append(log, row);
    setTimeout(() => input.focus(), 0);
  }

  function showThemes() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-themes", "UI Theme");
    const intro = document.createElement("div");
    intro.className = "pb-small";
    intro.textContent = "Auto keeps the classic Pocket Bird behavior: the UI follows your selected bird or Buddy. Pick a theme here to override it everywhere.";
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    const selected = themes.snapshot().id;
    for (const theme of themes.themes()) {
      const card = document.createElement("div");
      card.className = `pb-card${selected === theme.id ? " selected" : ""}`;
      if (theme.id === "auto") {
        card.innerHTML = `<b>${theme.label}</b><div class="pb-small">${theme.description}</div>`;
      } else {
        const swatch = document.createElement("div");
        swatch.className = "pb-theme-swatch";
        swatch.innerHTML = `<i style="background:${theme.accent}"></i><i style="background:${theme.background}"></i>`;
        const label = document.createElement("b");
        label.textContent = theme.label;
        card.append(swatch, label);
      }
      card.onclick = async () => {
        await themes.set(theme.id);
        toast(root, theme.id === "auto" ? "Theme follows Buddy" : `${theme.label} theme active`);
        showThemes();
      };
      grid.append(card);
    }
    c.append(intro, grid);
  }

  async function selectPet(id) {
    await library.setActive(id);
    await runtime.select(id);
    const pack = id === "pocket-bird" ? null : (await library.listInstalled()).find((item) => item.id === id) ?? null;
    await themes.setActiveBuddy(id, pack);
    toast(root, id === "pocket-bird" ? "Pocket Bird active" : `${pack?.displayName ?? "Buddy"} active`);
  }

  async function showPets() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-pets", "Buddies & Field Guide");
    const intro = document.createElement("div");
    intro.className = "pb-small";
    intro.textContent = "Pocket Bird collection stays intact. Add Prismtek PixelLab or any OpenPets package here; private art stays local.";
    c.append(intro);
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    const active = await library.activeId();
    const installed = await library.listInstalled();
    const card = (name, description, fn, locked = false, selected = false) => {
      const element = document.createElement("div");
      element.className = `pb-card${locked ? " locked" : ""}${selected ? " selected" : ""}`;
      element.innerHTML = `<b>${name}</b><div class="pb-small">${description}</div>`;
      if (fn) element.onclick = fn;
      grid.append(element);
    };
    card("Pocket Bird", "Original birds, hats, feathers and motion.", () => selectPet("pocket-bird"), false, active === "pocket-bird");
    for (const recipe of PRISMTEK_PACK_RECIPES.filter((item) => item.kind === "buddy")) {
      const pack = installed.find((item) => item.id === recipe.id);
      card(recipe.displayName, pack ? `${pack.source} • ${pack.id === active ? "ACTIVE" : "tap to use"}` : `Import ${recipe.archiveName}`, pack ? () => selectPet(pack.id) : null, !pack, pack?.id === active);
    }
    for (const pack of installed.filter((item) => item.kind !== "human" && !PRISMTEK_PACK_RECIPES.some((recipe) => recipe.id === item.id))) {
      card(pack.displayName, `${pack.source}${pack.id === active ? " • ACTIVE" : ""}`, () => selectPet(pack.id), false, pack.id === active);
    }
    c.append(grid, importButton(root, library, async (pack) => {
      if (pack.kind === "human") {
        await library.setHomeHuman(pack.id);
        await home.reloadHuman();
      } else {
        await selectPet(pack.id);
      }
      showPets();
    }));
    const human = installed.find((item) => item.kind === "human");
    c.append(Object.assign(document.createElement("div"), { textContent: human ? `Home player: ${human.displayName}` : "Home player: import Ani_Iso_Human.zip for your exact human" }));
    c.append(btn("Browse OpenPets Gallery", showGallery), btn("Open OpenPets website", () => window.open(OPENPETS_GALLERY_URL, "_blank", "noopener")));
  }

  async function installCatalogPet(entry) {
    if (typeof entry.zip !== "string" && !entry.downloadUrl) return toast(root, "This catalog entry has no package URL");
    const url = entry.zip || entry.downloadUrl;
    try {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error(`download ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `${entry.id}.zip`, { type: "application/zip" });
      const pack = await library.importFile(file);
      await selectPet(pack.id);
      toast(root, `${pack.displayName} installed`);
    } catch {
      toast(root, "Host blocked direct install; download the ZIP and use Import pet ZIP");
    }
  }

  async function showGallery() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-gallery", "OpenPets Gallery");
    c.append(Object.assign(document.createElement("div"), { className: "pb-small", textContent: "Loading the current OpenPets catalog…" }));
    const pets = await openPetsCatalog();
    c.innerHTML = "";
    if (!pets.length) {
      c.append(
        Object.assign(document.createElement("div"), { textContent: "This page blocks the OpenPets catalog. You can still import any OpenPets ZIP locally." }),
        importButton(root, library, async (pack) => { await selectPet(pack.id); showGallery(); }),
      );
      return;
    }
    const search = document.createElement("input");
    search.placeholder = `Search ${pets.length} OpenPets pets…`;
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    const render = () => {
      grid.innerHTML = "";
      const query = search.value.trim().toLowerCase();
      for (const pet of pets.filter((item) => !query || `${item.displayName} ${item.description || ""} ${item.id}`.toLowerCase().includes(query)).slice(0, 80)) {
        const card = document.createElement("div");
        card.className = "pb-card";
        card.innerHTML = `<b>${pet.displayName}</b><div class="pb-small">${pet.description || pet.id}</div>`;
        card.onclick = () => installCatalogPet(pet);
        grid.append(card);
      }
    };
    search.oninput = render;
    c.append(search, grid);
    render();
  }

  function augmentMainMenu(menu) {
    if (menu.dataset.pocketBuddyMain) return;
    menu.dataset.pocketBuddyMain = "1";
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    const first = content.querySelector(".birb-menu-item");
    if (first && !first.dataset.pocketBuddyCare) {
      first.dataset.pocketBuddyCare = "1";
      first.addEventListener("click", () => { void brain.care("pet").then((result) => toast(root, result.message)); });
    }
    const items = [
      menuItem("Talk", () => { closeBaseMenu(root); showTalk(); }),
      menuItem("Home", () => { closeBaseMenu(root); home.open(); }),
      menuItem("Care", () => { closeBaseMenu(root); showCare(); }),
      menuItem("Buddy Brain", () => { closeBaseMenu(root); showBrain(); }),
      menuItem("Buddies", () => { closeBaseMenu(root); showPets(); }),
    ];
    let cursor = first;
    for (const item of items) {
      if (cursor) { cursor.after(item); cursor = item; }
      else content.append(item);
    }
  }

  function augmentSettingsMenu(menu) {
    if (menu.dataset.pocketBuddySettings) return;
    menu.dataset.pocketBuddySettings = "1";
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    const item = menuItem(() => "", () => {});
    item.textContent = `UI Theme: ${themes.snapshot().label}`;
    item.onclick = () => { closeBaseMenu(root); showThemes(); };
    const firstSeparator = content.querySelector(".birb-window-separator");
    if (firstSeparator) firstSeparator.after(item);
    else content.append(item);
  }

  function augmentFieldGuide(guide) {
    if (guide.dataset.pocketBuddy) return;
    guide.dataset.pocketBuddy = "1";
    const content = guide.querySelector(".birb-window-content");
    if (!content) return;
    const section = document.createElement("div");
    section.className = "pb-guide-bridge";
    const label = document.createElement("div");
    label.className = "birb-field-guide-section-label";
    label.textContent = "----- Buddies -----";
    const note = document.createElement("div");
    note.className = "birb-field-guide-description";
    note.textContent = "Pocket Bird species live above. Prismtek Buddies and OpenPets packs live in the same Pocket Buddy Field Guide.";
    const open = btn("Open Buddies & OpenPets", () => showPets());
    open.style.margin = "6px 10px 10px";
    section.append(label, note, open);
    content.append(section);
  }

  const observer = new MutationObserver(() => {
    const menu = root.getElementById("birb-menu");
    if (menu) {
      if (isSettingsMenu(menu)) augmentSettingsMenu(menu);
      else augmentMainMenu(menu);
    }
    const guide = root.getElementById("birb-field-guide");
    if (guide) augmentFieldGuide(guide);
  });
  observer.observe(root, { childList: true, subtree: true });

  setInterval(() => void brain.tick(), 60_000);

  window.PocketBuddy = {
    coreVersion: POCKET_BUDDY_VERSION,
    brain,
    library,
    runtime,
    home,
    themes,
    showPets,
    showTalk,
    showCare,
    showBrain,
    showThemes,
    care,
    openPetsCatalog,
  };
  window.dispatchEvent(new CustomEvent("pocket-buddy-core-ready", { detail: { version: window.PocketBuddy.coreVersion } }));
  return window.PocketBuddy;
}
