import {
	BUDDY_CARE_ACTIONS,
	BUDDY_TRAINING_TRAITS,
	advanceBuddyState,
	applyBuddyCare,
	buddySnapshot,
	talkToBuddy,
	trainBuddy,
} from "./buddy-core.js";
import {
	MAX_MY_PET_DATA_URL_CHARS,
	MAX_MY_PETS,
	loadBuddyDocument,
	normalizeMyPet,
	saveBuddyDocument,
} from "./buddy-storage.js";
import { PocketBuddyPetOverlay } from "./buddy-pet-overlay.js";
import { OpenPetsCatalogClient } from "./openpets-catalog.js";
import { closeBuddyHome, isBuddyHomeOpen, openBuddyHome } from "./buddy-home.js";
import {
	MenuItem,
	Separator,
	menuItemText,
	registerMenuTransformer,
	switchMenuItems,
} from "./menu.js";
import {
	getContext,
	getShadowRoot,
	makeClosable,
	makeDraggable,
	makeElement,
	onClick,
} from "./shared.js";

const BUDDY_RUNTIME_VERSION = 1;
const STATUS_WINDOW_ID = "pocket-buddy-status";
const TALK_WINDOW_ID = "pocket-buddy-talk";
const TRAIN_WINDOW_ID = "pocket-buddy-train";
const FIELD_GUIDE_ID = "birb-field-guide";
const SAVE_INTERVAL_MS = 5 * 60 * 1000;
const NAME_SYNC_INTERVAL_MS = 60 * 1000;
const PET_GESTURE_COOLDOWN_MS = 5000;

let initialized = false;
let buddyDocument = null;
let overlay = null;
let rootMenuItems = null;
let catalogClient = null;
let aiProvider = null;
let rootObserver = null;
let lastPetGestureAt = 0;
let petGestureStack = [];
let toastTimer = 0;

export async function initializeBuddy() {
	if (initialized) return;
	initialized = true;
	const displayName = await legacyPetName();
	buddyDocument = await loadBuddyDocument(displayName);
	buddyDocument.buddy = advanceBuddyState(buddyDocument.buddy, Date.now());
	if (displayName && displayName !== "Buddy") buddyDocument.buddy.displayName = displayName;
	await persist();

	installBuddyStyles();
	registerMenuTransformer(transformPocketBuddyMenus);
	window.addEventListener("pocket-buddy:menu-action", handleLegacyMenuAction);

	const source = await waitForPetCanvas();
	if (source) {
		overlay = new PocketBuddyPetOverlay(source);
		installPetGestureBridge(source);
		if (buddyDocument.selectedPet) {
			try { await overlay.select(buddyDocument.selectedPet); }
			catch {
				buddyDocument.selectedPet = null;
				overlay.clear();
				await persist();
				showToast("That pet could not be loaded, so I switched back to the Pocket Buddy pet.");
			}
		}
		installFieldGuideObserver();
		if (buddyDocument.preferences.showHome) openHome();
	}

	setInterval(() => {
		if (!buddyDocument) return;
		buddyDocument.buddy = advanceBuddyState(buddyDocument.buddy, Date.now());
		void persist();
	}, SAVE_INTERVAL_MS);
	setInterval(() => void syncLegacyName(), NAME_SYNC_INTERVAL_MS);

	exposePublicApi();
	window.dispatchEvent(new CustomEvent("pocket-buddy:ready", { detail: { version: BUDDY_RUNTIME_VERSION } }));
}

function transformPocketBuddyMenus(items) {
	const labels = items.map(menuItemText);
	const isRoot = labels.includes("Field Guide") && labels.includes("Wardrobe");
	if (isRoot) {
		rootMenuItems = items;
		for (const item of items) {
			const label = menuItemText(item);
			if (/^Pet (Bird|Birb)$/i.test(label)) item.text = "Pet Buddy";
			if (/^Hide (Bird|Birb)$/i.test(label)) item.text = "Hide Buddy";
		}
		const filtered = items.filter((item) => !/^Adopt A /i.test(menuItemText(item)));
		const output = [];
		for (let index = 0; index < filtered.length; index += 1) {
			output.push(filtered[index]);
			if (index === 0) {
				output.push(new MenuItem("Buddy", () => switchMenuItems(buddyMenu(), positionMenuNearPet), undefined, false));
				output.push(new MenuItem(() => isBuddyHomeOpen() ? "Close Home" : "Home", toggleHome));
			}
		}
		return output;
	}

	const isSettings = labels.includes("Go Back") && labels.includes("UI Scale");
	if (isSettings) {
		const filtered = [];
		for (const item of items) {
			const label = menuItemText(item);
			if (/^Rename Your (Bird|Birb)$/i.test(label)) item.text = "Rename Buddy";
			if (/^(Bird|Birb) Scale$/i.test(label)) item.text = "Buddy Scale";
			if (label.startsWith("Source Code") || label.startsWith("Build ")) continue;
			filtered.push(item);
		}
		const separatorIndex = filtered.map(menuItemText).lastIndexOf("");
		const homeSetting = new MenuItem(
			() => buddyDocument?.preferences.showHome ? "Hide Home by default" : "Show Home by default",
			() => setHomePreference(!buddyDocument?.preferences.showHome),
		);
		if (separatorIndex >= 0) filtered.splice(separatorIndex, 0, homeSetting);
		else filtered.push(homeSetting, new Separator());
		filtered.push(
			new MenuItem("Source Code", () => window.open("https://github.com/codysumpter-cloud/Pocket-Buddy", "_blank")),
			new MenuItem("Build __VERSION__", () => alert("Thank you for using Pocket Buddy! You are on version: __VERSION__"), undefined, false),
		);
		return filtered;
	}
	return items;
}

function buddyMenu() {
	return [
		new MenuItem("Go Back", () => switchMenuItems(rootMenuItems ?? [], positionMenuNearPet), undefined, false),
		new Separator(),
		new MenuItem("Status", openStatusWindow),
		new MenuItem("Talk", openTalkWindow),
		new MenuItem("Care", () => switchMenuItems(careMenu(), positionMenuNearPet), undefined, false),
		new MenuItem("Train", openTrainWindow),
	];
}

function careMenu() {
	return [
		new MenuItem("Go Back", () => switchMenuItems(buddyMenu(), positionMenuNearPet), undefined, false),
		new Separator(),
		new MenuItem("Pet", () => void care("pet")),
		new MenuItem("Feed", () => void care("feed")),
		new MenuItem("Play", () => void care("play")),
		new MenuItem("Rest", () => void care("rest")),
		new MenuItem("Clean", () => void care("clean")),
	];
}

function positionMenuNearPet(menu) {
	const source = getShadowRoot().querySelector("#birb");
	if (!(source instanceof HTMLElement)) return;
	const rect = source.getBoundingClientRect();
	const width = menu.offsetWidth || 160;
	const height = menu.offsetHeight || 220;
	let x = rect.left < window.innerWidth / 2 ? rect.right + 18 : rect.left - width - 18;
	let y = rect.top < window.innerHeight / 2 ? rect.bottom + 12 : rect.top - height - 12;
	x = Math.max(8, Math.min(window.innerWidth - width - 8, x));
	y = Math.max(8, Math.min(window.innerHeight - height - 8, y));
	menu.style.left = `${x}px`;
	menu.style.top = `${y}px`;
}

async function handleLegacyMenuAction(event) {
	if (event?.detail?.label === "Pet Buddy") await care("pet", false);
}

async function care(action, feedback = true) {
	if (!buddyDocument || !BUDDY_CARE_ACTIONS.includes(action)) return;
	buddyDocument.buddy = applyBuddyCare(buddyDocument.buddy, action, Date.now());
	overlay?.react(action);
	await persist();
	if (feedback) {
		const messages = { pet: "Buddy leans into the head pats.", feed: "Crunch crunch. Snack mission complete.", play: "Buddy has the zoomies now.", rest: "Tiny nap protocol engaged.", clean: "Buddy is fresh and presentable again." };
		showToast(messages[action] ?? "Buddy appreciated that.");
	}
	emitState();
}

function toggleHome() {
	if (isBuddyHomeOpen()) closeBuddyHome();
	else openHome();
}

function openHome() {
	if (!buddyDocument || !overlay) return;
	openBuddyHome({
		getBuddySnapshot: () => buddySnapshot(buddyDocument.buddy, Date.now()),
		onCare: (action) => care(action),
		getPetCanvas: () => overlay?.visualCanvas ?? null,
		initialMode: buddyDocument.preferences.homeMode,
		onOpenChange: (open) => {
			overlay?.setStandaloneVisible(!open);
			buddyDocument.preferences.showHome = open;
			void persist();
		},
	});
}

async function setHomePreference(show) {
	if (!buddyDocument) return;
	buddyDocument.preferences.showHome = show === true;
	await persist();
	if (show) openHome();
	else if (isBuddyHomeOpen()) closeBuddyHome();
	showToast(show ? "Home will open with Buddy." : "Buddy will stay out on the page by default.");
}

function openStatusWindow() {
	closeWindow(STATUS_WINDOW_ID);
	const content = makeElement("pocket-buddy-status-content");
	const render = () => {
		if (!content.isConnected || !buddyDocument) return;
		buddyDocument.buddy = advanceBuddyState(buddyDocument.buddy, Date.now());
		const snapshot = buddySnapshot(buddyDocument.buddy, Date.now());
		content.textContent = "";
		const hero = makeElement("pocket-buddy-status-hero");
		const title = document.createElement("b");
		title.textContent = `${snapshot.displayName} · Lv ${snapshot.level}`;
		const detail = document.createElement("span");
		detail.textContent = `${capitalize(snapshot.mood)} · ${capitalize(snapshot.activity)} · ${Math.round(snapshot.affection * 100)}% affection`;
		hero.append(title, detail);
		content.appendChild(hero);
		for (const [need, pressure] of Object.entries(snapshot.needs)) content.appendChild(progressRow(capitalize(need), pressure));
		const pet = makeElement("pocket-buddy-status-foot", `Active pet: ${buddyDocument.selectedPet?.displayName ?? "Pocket Buddy"} · XP ${snapshot.xp}`);
		content.appendChild(pet);
	};
	render();
	const windowElement = createBuddyWindow(STATUS_WINDOW_ID, "Buddy Status", content);
	const timer = setInterval(() => { if (!windowElement.isConnected) clearInterval(timer); else render(); }, 1000);
}

function progressRow(label, value) {
	const row = makeElement("pocket-buddy-need-row");
	const name = document.createElement("span");
	name.textContent = label;
	const track = makeElement("pocket-buddy-need-track");
	const fill = makeElement("pocket-buddy-need-fill");
	fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
	track.appendChild(fill);
	const number = document.createElement("span");
	number.textContent = `${Math.round(value * 100)}%`;
	row.append(name, track, number);
	return row;
}

function openTalkWindow() {
	closeWindow(TALK_WINDOW_ID);
	const wrapper = makeElement("pocket-buddy-talk-content");
	const history = makeElement("pocket-buddy-talk-history");
	const composer = makeElement("pocket-buddy-talk-composer");
	const input = document.createElement("input");
	input.className = "pocket-buddy-talk-input";
	input.placeholder = "Say something to Buddy…";
	input.maxLength = 500;
	const send = document.createElement("button");
	send.textContent = "Send";
	composer.append(input, send);
	wrapper.append(history, composer);

	const render = () => {
		history.textContent = "";
		for (const message of buddyDocument?.buddy.messages?.slice(-20) ?? []) {
			const line = makeElement(`pocket-buddy-message pocket-buddy-message-${message.role}`);
			const speaker = document.createElement("b");
			speaker.textContent = message.role === "user" ? "You: " : `${buddyDocument.buddy.displayName}: `;
			line.append(speaker, document.createTextNode(message.text));
			history.appendChild(line);
		}
		history.scrollTop = history.scrollHeight;
	};

	const submit = async () => {
		const message = input.value.trim();
		if (!message || !buddyDocument) return;
		input.value = "";
		input.disabled = true;
		send.disabled = true;
		let result = talkToBuddy(buddyDocument.buddy, message, Date.now());
		if (aiProvider) {
			try {
				const response = await aiProvider({ message, profile: buddySnapshot(result.state, Date.now()), history: result.state.messages.slice(-16).map(({ role, text }) => ({ role, text })) });
				const text = typeof response === "string" ? response : typeof response?.text === "string" ? response.text : "";
				if (text.trim()) {
					const messages = [...result.state.messages];
					messages[messages.length - 1] = { ...messages[messages.length - 1], text: text.trim().slice(0, 500) };
					result = { ...result, state: { ...result.state, messages }, reply: text.trim().slice(0, 500) };
				}
			} catch { showToast("Connected brain was unavailable, so Buddy answered locally."); }
		}
		buddyDocument.buddy = result.state;
		await persist();
		render();
		input.disabled = false;
		send.disabled = false;
		input.focus();
		emitState();
	};

	onClick(send, () => void submit());
	input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } });
	render();
	createBuddyWindow(TALK_WINDOW_ID, "Talk to Buddy", wrapper);
	setTimeout(() => input.focus(), 0);
}

function openTrainWindow() {
	closeWindow(TRAIN_WINDOW_ID);
	const content = makeElement("pocket-buddy-train-content");
	const intro = makeElement("pocket-buddy-train-intro", "Training shapes Buddy’s personality and earns XP.");
	const grid = makeElement("pocket-buddy-train-grid");
	content.append(intro, grid);
	const render = () => {
		grid.textContent = "";
		for (const trait of BUDDY_TRAINING_TRAITS) {
			const button = document.createElement("button");
			const count = buddyDocument?.buddy.training?.[trait] ?? 0;
			const value = buddyDocument?.buddy.personality?.[trait] ?? 0;
			button.textContent = `${capitalize(trait)} · ${Math.round(value * 100)}% · ${count}x`;
			onClick(button, async () => {
				buddyDocument.buddy = trainBuddy(buddyDocument.buddy, trait, Date.now());
				await persist();
				overlay?.react("success");
				showToast(`${capitalize(trait)} training complete.`);
				render();
				emitState();
			});
			grid.appendChild(button);
		}
	};
	render();
	createBuddyWindow(TRAIN_WINDOW_ID, "Train Buddy", content);
}

function createBuddyWindow(id, title, content) {
	const windowElement = makeElement("birb-window", undefined, id);
	windowElement.classList.add("pocket-buddy-feature-window");
	const header = makeElement("birb-window-header");
	const titleElement = makeElement("birb-window-title", title);
	const closeButton = makeElement("birb-window-close", "x");
	header.append(titleElement, closeButton);
	const wrapper = makeElement("birb-window-content");
	wrapper.appendChild(content);
	windowElement.append(header, wrapper);
	getShadowRoot().appendChild(windowElement);
	makeDraggable(header);
	makeClosable(() => windowElement.remove(), closeButton);
	centerWindow(windowElement);
	return windowElement;
}

function closeWindow(id) {
	getShadowRoot().querySelector(`#${id}`)?.remove();
}

function centerWindow(element) {
	requestAnimationFrame(() => {
		element.style.left = `${Math.max(10, window.innerWidth / 2 - element.offsetWidth / 2)}px`;
		element.style.top = `${Math.max(16, window.innerHeight / 2 - element.offsetHeight / 2)}px`;
	});
}

function installFieldGuideObserver() {
	const root = getShadowRoot();
	rootObserver?.disconnect();
	rootObserver = new MutationObserver(() => queueMicrotask(enhanceFieldGuide));
	rootObserver.observe(root, { childList: true, subtree: true });
	enhanceFieldGuide();
}

function enhanceFieldGuide() {
	const fieldGuide = getShadowRoot().querySelector(`#${FIELD_GUIDE_ID}`);
	if (!(fieldGuide instanceof HTMLElement) || fieldGuide.dataset.pocketBuddyEnhanced === "true") return;
	const wrapper = fieldGuide.querySelector(".birb-window-content > div");
	if (!(wrapper instanceof HTMLElement) || wrapper.children.length === 0) return;
	fieldGuide.dataset.pocketBuddyEnhanced = "true";
	fieldGuide.classList.add("pocket-buddy-field-guide");

	const originals = [...wrapper.children];
	const tabs = makeElement("pocket-buddy-field-tabs");
	const builtInTab = document.createElement("button"); builtInTab.textContent = "Pocket Buddy";
	const openPetsTab = document.createElement("button"); openPetsTab.textContent = "OpenPets";
	const myPetsTab = document.createElement("button"); myPetsTab.textContent = "My Pets";
	tabs.append(builtInTab, openPetsTab, myPetsTab);

	const builtInPanel = makeElement("pocket-buddy-field-panel");
	for (const child of originals) builtInPanel.appendChild(child);
	const openPetsPanel = createOpenPetsPanel();
	const myPetsPanel = createMyPetsPanel();
	wrapper.append(tabs, builtInPanel, openPetsPanel, myPetsPanel);

	const activate = (name) => {
		builtInPanel.hidden = name !== "builtin";
		openPetsPanel.hidden = name !== "openpets";
		myPetsPanel.hidden = name !== "mypets";
		builtInTab.classList.toggle("active", name === "builtin");
		openPetsTab.classList.toggle("active", name === "openpets");
		myPetsTab.classList.toggle("active", name === "mypets");
		if (name === "openpets") void ensureOpenPetsLoaded(openPetsPanel);
		if (name === "mypets") renderMyPetsPanel(myPetsPanel);
	};
	onClick(builtInTab, () => activate("builtin"));
	onClick(openPetsTab, () => activate("openpets"));
	onClick(myPetsTab, () => activate("mypets"));
	builtInPanel.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target.closest(".birb-grid-item") : null;
		if (target && !target.classList.contains("birb-grid-item-locked")) setTimeout(() => void selectBuiltInPet(), 0);
	});
	activate("builtin");
	centerWindow(fieldGuide);
}

function createOpenPetsPanel() {
	const panel = makeElement("pocket-buddy-field-panel pocket-buddy-openpets-panel");
	panel.hidden = true;
	const controls = makeElement("pocket-buddy-field-controls");
	const search = document.createElement("input");
	search.placeholder = "Search loaded OpenPets…";
	search.className = "pocket-buddy-field-search";
	const more = document.createElement("button"); more.textContent = "Load more";
	const all = document.createElement("button"); all.textContent = "Load all";
	controls.append(search, more, all);
	const status = makeElement("pocket-buddy-field-status", "OpenPets loads when you open this tab.");
	const grid = makeElement("pocket-buddy-pet-grid");
	panel.append(controls, status, grid);
	panel._buddy = { search, more, all, status, grid, loading: false };
	search.addEventListener("input", () => renderOpenPetsPanel(panel));
	onClick(more, () => void loadMoreOpenPets(panel));
	onClick(all, () => void loadAllOpenPets(panel));
	return panel;
}

async function ensureOpenPetsLoaded(panel) {
	if (!catalogClient) catalogClient = new OpenPetsCatalogClient();
	if (catalogClient.mode !== "uninitialized") { renderOpenPetsPanel(panel); return; }
	const refs = panel._buddy;
	refs.loading = true;
	refs.status.textContent = "Loading OpenPets…";
	try { await catalogClient.initialize(); }
	catch (error) { refs.status.textContent = String(error?.message ?? error).slice(0, 160); }
	refs.loading = false;
	renderOpenPetsPanel(panel);
}

async function loadMoreOpenPets(panel) {
	await ensureOpenPetsLoaded(panel);
	if (!catalogClient?.hasMore || panel._buddy.loading) return;
	panel._buddy.loading = true;
	panel._buddy.status.textContent = "Loading more OpenPets…";
	try { await catalogClient.loadNextPage(); }
	catch (error) { panel._buddy.status.textContent = String(error?.message ?? error).slice(0, 160); }
	panel._buddy.loading = false;
	renderOpenPetsPanel(panel);
}

async function loadAllOpenPets(panel) {
	await ensureOpenPetsLoaded(panel);
	if (!catalogClient?.hasMore || panel._buddy.loading) return;
	panel._buddy.loading = true;
	panel._buddy.status.textContent = "Loading the full OpenPets Field Guide…";
	try { await catalogClient.loadAll(); }
	catch (error) { panel._buddy.status.textContent = String(error?.message ?? error).slice(0, 160); }
	panel._buddy.loading = false;
	renderOpenPetsPanel(panel);
}

function renderOpenPetsPanel(panel) {
	const refs = panel._buddy;
	if (!refs || !catalogClient) return;
	const snapshot = catalogClient.snapshot();
	const query = refs.search.value.trim().toLowerCase();
	const pets = snapshot.pets.filter((pet) => !query || `${pet.displayName} ${pet.id} ${pet.description} ${pet.category}`.toLowerCase().includes(query));
	refs.grid.textContent = "";
	for (const pet of pets) refs.grid.appendChild(createPetCard(pet, () => void selectExternalPet(pet)));
	refs.status.textContent = snapshot.mode === "error" ? "OpenPets is unavailable right now." : `${snapshot.loadedCount} of ${snapshot.total || snapshot.loadedCount} OpenPets loaded${query ? ` · ${pets.length} match` : ""}.`;
	refs.more.disabled = refs.loading || !snapshot.hasMore;
	refs.all.disabled = refs.loading || !snapshot.hasMore;
}

function createMyPetsPanel() {
	const panel = makeElement("pocket-buddy-field-panel pocket-buddy-mypets-panel");
	panel.hidden = true;
	const controls = makeElement("pocket-buddy-field-controls");
	const importButton = document.createElement("button");
	importButton.textContent = "Import pet";
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.accept = ".json,.webp,.png,.gif,.jpg,.jpeg";
	input.hidden = true;
	controls.append(importButton, input);
	const status = makeElement("pocket-buddy-field-status", "Import an OpenPets pet.json + spritesheet, or a standalone sprite image.");
	const grid = makeElement("pocket-buddy-pet-grid");
	panel.append(controls, status, grid);
	panel._buddy = { input, status, grid };
	onClick(importButton, () => input.click());
	input.addEventListener("change", () => void importMyPet(panel, [...(input.files ?? [])]));
	return panel;
}

async function importMyPet(panel, files) {
	const refs = panel._buddy;
	if (!files.length || !buddyDocument) return;
	const jsonFile = files.find((file) => file.name.toLowerCase() === "pet.json") ?? files.find((file) => file.name.toLowerCase().endsWith(".json"));
	let metadata = {};
	if (jsonFile) {
		try { metadata = JSON.parse(await jsonFile.text()); }
		catch { refs.status.textContent = "That pet.json is not valid JSON."; return; }
	}
	const wantedName = typeof metadata?.spritesheetPath === "string" ? metadata.spritesheetPath.split(/[\\/]/).pop()?.toLowerCase() : "";
	const images = files.filter((file) => /^image\//.test(file.type) || /\.(webp|png|gif|jpe?g)$/i.test(file.name));
	const imageFile = images.find((file) => wantedName && file.name.toLowerCase() === wantedName) ?? images.find((file) => /spritesheet/i.test(file.name)) ?? images[0];
	if (!imageFile) { refs.status.textContent = "Choose the pet sprite image too."; return; }
	if (imageFile.size * 1.38 > MAX_MY_PET_DATA_URL_CHARS) { refs.status.textContent = "That sprite is too large for Pocket Buddy’s portable My Pets store."; return; }
	const dataUrl = await readFileDataUrl(imageFile);
	const idSource = metadata?.id || imageFile.name.replace(/\.[^.]+$/, "") || "my-pet";
	const pet = normalizeMyPet({
		id: String(idSource),
		displayName: metadata?.displayName || metadata?.name || humanizeFileName(imageFile.name),
		description: metadata?.description || "Imported through My Pets",
		dataUrl,
		importedAt: Date.now(),
	});
	if (!pet) { refs.status.textContent = "That image format could not be stored."; return; }
	buddyDocument.myPets = [...buddyDocument.myPets.filter((existing) => existing.id !== pet.id), pet].slice(-MAX_MY_PETS);
	await selectExternalPet(pet);
	refs.input.value = "";
	refs.status.textContent = `${pet.displayName} added to My Pets.`;
	renderMyPetsPanel(panel);
}

function renderMyPetsPanel(panel) {
	const refs = panel._buddy;
	if (!refs || !buddyDocument) return;
	refs.grid.textContent = "";
	for (const pet of buddyDocument.myPets) {
		const card = createPetCard(pet, () => void selectExternalPet(pet));
		const remove = document.createElement("button");
		remove.className = "pocket-buddy-pet-remove";
		remove.textContent = "×";
		remove.title = `Remove ${pet.displayName}`;
		remove.addEventListener("click", async (event) => {
			event.stopPropagation();
			buddyDocument.myPets = buddyDocument.myPets.filter((candidate) => candidate.id !== pet.id);
			if (buddyDocument.selectedPet?.source === "local" && buddyDocument.selectedPet.id === pet.id) await selectBuiltInPet();
			else await persist();
			renderMyPetsPanel(panel);
		});
		card.appendChild(remove);
		refs.grid.appendChild(card);
	}
	if (buddyDocument.myPets.length === 0) refs.status.textContent = "No imported pets yet. pet.json + spritesheet.webp works best.";
	else refs.status.textContent = `${buddyDocument.myPets.length} pet${buddyDocument.myPets.length === 1 ? "" : "s"} in My Pets.`;
}

function createPetCard(pet, select) {
	const card = makeElement("pocket-buddy-pet-card");
	if (buddyDocument?.selectedPet?.source === pet.source && buddyDocument.selectedPet?.id === pet.id) card.classList.add("selected");
	const preview = document.createElement("canvas");
	preview.width = 64;
	preview.height = 64;
	preview.className = "pocket-buddy-pet-preview";
	drawPetPreview(preview, pet.dataUrl || pet.thumbnailUrl || pet.spriteUrl);
	const label = makeElement("pocket-buddy-pet-label", pet.displayName);
	card.title = pet.description || pet.displayName;
	card.append(preview, label);
	onClick(card, select);
	return card;
}

function drawPetPreview(canvas, src) {
	if (!src) return;
	const image = new Image();
	if (!String(src).startsWith("data:")) image.crossOrigin = "anonymous";
	image.onload = () => {
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, 64, 64);
		ctx.imageSmoothingEnabled = false;
		const width = image.naturalWidth || image.width;
		const height = image.naturalHeight || image.height;
		const atlas = width % 8 === 0 && height % 9 === 0 && width / 8 >= 8 && height / 9 >= 8;
		const sw = atlas ? width / 8 : width;
		const sh = atlas ? height / 9 : height;
		const scale = Math.min(60 / sw, 60 / sh);
		const dw = Math.max(1, Math.round(sw * scale));
		const dh = Math.max(1, Math.round(sh * scale));
		try { ctx.drawImage(image, 0, 0, sw, sh, Math.round((64 - dw) / 2), 62 - dh, dw, dh); } catch { /* text label still works */ }
	};
	image.src = src;
}

async function selectExternalPet(pet) {
	if (!buddyDocument || !overlay) return;
	try {
		await overlay.select(pet);
		buddyDocument.selectedPet = pet.source === "local" ? buddyDocument.myPets.find((candidate) => candidate.id === pet.id) ?? pet : pet;
		await persist();
		showToast(`${pet.displayName} is now your active Buddy pet.`);
		emitState();
		refreshOpenFieldGuide();
	} catch (error) {
		showToast(String(error?.message ?? error).slice(0, 140));
	}
}

async function selectBuiltInPet() {
	if (!buddyDocument || !overlay || !buddyDocument.selectedPet) return;
	buddyDocument.selectedPet = null;
	overlay.clear();
	await persist();
	showToast("Back to your Pocket Buddy pet.");
	emitState();
	refreshOpenFieldGuide();
}

function refreshOpenFieldGuide() {
	const guide = getShadowRoot().querySelector(`#${FIELD_GUIDE_ID}`);
	if (!guide) return;
	const openPanel = guide.querySelector(".pocket-buddy-openpets-panel");
	const myPanel = guide.querySelector(".pocket-buddy-mypets-panel");
	if (openPanel) renderOpenPetsPanel(openPanel);
	if (myPanel) renderMyPetsPanel(myPanel);
}

function installPetGestureBridge(source) {
	source.addEventListener("mouseover", () => {
		const now = Date.now();
		petGestureStack.push(now);
		petGestureStack = petGestureStack.filter((time) => now - time < 1000).slice(-6);
		if (petGestureStack.length >= 3 && now - lastPetGestureAt >= PET_GESTURE_COOLDOWN_MS) {
			lastPetGestureAt = now;
			petGestureStack = [];
			void care("pet", false);
		}
	});
	source.addEventListener("touchmove", () => {
		const now = Date.now();
		if (now - lastPetGestureAt >= PET_GESTURE_COOLDOWN_MS) {
			lastPetGestureAt = now;
			void care("pet", false);
		}
	});
}

async function waitForPetCanvas() {
	for (let attempt = 0; attempt < 240; attempt += 1) {
		const source = getShadowRoot().querySelector("#birb");
		if (source instanceof HTMLCanvasElement) return source;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return null;
}

async function legacyPetName() {
	try {
		const save = await getContext().getSaveData();
		const name = save?.settings?.name;
		return typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Buddy";
	} catch {
		return "Buddy";
	}
}

async function syncLegacyName() {
	if (!buddyDocument) return;
	const name = await legacyPetName();
	if (name !== "Buddy" && name !== buddyDocument.buddy.displayName) {
		buddyDocument.buddy.displayName = name;
		await persist();
		emitState();
	}
}

async function persist() {
	if (!buddyDocument) return;
	buddyDocument = await saveBuddyDocument(buddyDocument);
}

function emitState() {
	if (!buddyDocument) return;
	window.dispatchEvent(new CustomEvent("pocket-buddy:state", { detail: buddySnapshot(buddyDocument.buddy, Date.now()) }));
}

function exposePublicApi() {
	window.PocketBuddy = {
		version: BUDDY_RUNTIME_VERSION,
		getProfile: () => buddyDocument ? buddySnapshot(buddyDocument.buddy, Date.now()) : null,
		getSelectedPet: () => buddyDocument?.selectedPet ? { ...buddyDocument.selectedPet, dataUrl: undefined } : null,
		care: (action) => care(action),
		openHome,
		closeHome: closeBuddyHome,
		registerAIProvider(provider) {
			if (provider !== null && typeof provider !== "function") throw new Error("Pocket Buddy AI provider must be a function or null.");
			aiProvider = provider;
			return () => { if (aiProvider === provider) aiProvider = null; };
		},
	};
}

function showToast(text) {
	const root = getShadowRoot();
	root.querySelector("#pocket-buddy-toast")?.remove();
	const toast = makeElement("pocket-buddy-toast", String(text).slice(0, 180), "pocket-buddy-toast");
	root.appendChild(toast);
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.remove(), 2600);
}

function installBuddyStyles() {
	const root = getShadowRoot();
	if (root.getElementById("pocket-buddy-feature-style")) return;
	const style = document.createElement("style");
	style.id = "pocket-buddy-feature-style";
	style.textContent = `
		[hidden] { display:none !important; }
		.pocket-buddy-feature-window { width:min(380px, 92vw); max-height:88vh; }
		.pocket-buddy-feature-window .birb-window-content { overflow:auto; align-items:stretch; padding:10px; }
		.pocket-buddy-status-content, .pocket-buddy-train-content, .pocket-buddy-talk-content { width:100%; box-sizing:border-box; font:12px Monocraft, monospace; }
		.pocket-buddy-status-hero { display:flex; flex-direction:column; gap:4px; padding:4px 2px 10px; }
		.pocket-buddy-status-hero span, .pocket-buddy-status-foot { opacity:.68; font-size:11px; }
		.pocket-buddy-need-row { display:grid; grid-template-columns:92px 1fr 38px; align-items:center; gap:6px; margin:5px 0; }
		.pocket-buddy-need-track { height:8px; background:#fff; border:1px solid var(--birb-border-color); overflow:hidden; }
		.pocket-buddy-need-fill { height:100%; background:var(--birb-highlight); }
		.pocket-buddy-talk-content { display:flex; flex-direction:column; gap:8px; min-height:260px; }
		.pocket-buddy-talk-history { flex:1; max-height:340px; overflow:auto; display:flex; flex-direction:column; gap:6px; padding:2px; }
		.pocket-buddy-message { padding:6px 7px; background:rgba(255,255,255,.55); border-left:3px solid var(--birb-highlight); }
		.pocket-buddy-message-user { opacity:.72; border-left-color:#777; }
		.pocket-buddy-talk-composer { display:flex; gap:6px; }
		.pocket-buddy-talk-input, .pocket-buddy-field-search { min-width:0; flex:1; font:12px Monocraft, monospace; border:2px solid var(--birb-highlight); background:#fff; padding:5px; box-sizing:border-box; }
		.pocket-buddy-talk-composer button, .pocket-buddy-train-grid button, .pocket-buddy-field-controls button { font:11px Monocraft, monospace; border:2px solid var(--birb-highlight); background:#fff; padding:5px 8px; cursor:pointer; }
		.pocket-buddy-train-intro { margin-bottom:8px; opacity:.7; }
		.pocket-buddy-train-grid { display:grid; gap:6px; }
		#pocket-buddy-toast { position:fixed; left:50%; bottom:72px; transform:translateX(-50%) scale(var(--birb-ui-scale)); transform-origin:bottom; max-width:min(420px,86vw); z-index:2147483642; font:12px Monocraft, monospace; color:#000; background:var(--birb-background-color); border:2px solid var(--birb-highlight); box-shadow:2px 2px 0 #fff; padding:7px 10px; }
		#birb-field-guide.pocket-buddy-field-guide { width:min(640px, 94vw); }
		.pocket-buddy-field-guide .birb-window-content { align-items:stretch; }
		.pocket-buddy-field-tabs { display:flex; gap:4px; padding:8px 10px 2px; position:sticky; top:0; z-index:2; background:var(--birb-background-color); }
		.pocket-buddy-field-tabs button { flex:1; font:11px Monocraft, monospace; border:2px solid var(--birb-highlight); background:#fff; padding:5px 4px; cursor:pointer; }
		.pocket-buddy-field-tabs button.active { color:#fff; background:var(--birb-highlight); }
		.pocket-buddy-field-panel { width:100%; box-sizing:border-box; }
		.pocket-buddy-field-controls { display:flex; gap:6px; padding:8px 10px 4px; }
		.pocket-buddy-field-status { min-height:16px; padding:3px 10px 5px; font:10px Monocraft, monospace; opacity:.65; }
		.pocket-buddy-pet-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(76px, 1fr)); gap:7px; padding:6px 10px 12px; }
		.pocket-buddy-pet-card { min-width:0; min-height:88px; position:relative; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:3px; padding:4px; box-sizing:border-box; border:2px solid transparent; cursor:pointer; background:rgba(255,255,255,.34); }
		.pocket-buddy-pet-card:hover, .pocket-buddy-pet-card.selected { border-color:var(--birb-highlight); background:#fff; }
		.pocket-buddy-pet-preview { width:58px; height:58px; image-rendering:pixelated; }
		.pocket-buddy-pet-label { max-width:100%; font:9px Monocraft, monospace; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
		.pocket-buddy-pet-remove { position:absolute; top:1px; right:1px; width:18px; height:18px; border:0; background:#ff7c7c; color:#fff; cursor:pointer; font:bold 13px monospace; line-height:16px; }
		@media (max-width:560px) { #birb-field-guide.pocket-buddy-field-guide { width:94vw; } .pocket-buddy-field-controls { flex-wrap:wrap; } .pocket-buddy-field-search { flex-basis:100%; } .pocket-buddy-pet-grid { grid-template-columns:repeat(auto-fill,minmax(68px,1fr)); } }
	`;
	root.appendChild(style);
}

function readFileDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("Could not read pet image."));
		reader.readAsDataURL(file);
	});
}

function humanizeFileName(name) {
	return String(name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 60);
}

function capitalize(value) {
	const text = String(value ?? "");
	return text ? text[0].toUpperCase() + text.slice(1) : text;
}
