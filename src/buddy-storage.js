import { createBuddyState, normalizeBuddyState } from "./buddy-core.js";

export const BUDDY_STORE_KEY = "pocketBuddyDataV1";
export const BUDDY_DOCUMENT_VERSION = 1;
export const MAX_MY_PETS = 12;
export const MAX_MY_PET_DATA_URL_CHARS = 3_500_000;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeText(value, fallback = "", max = 160) { const text = typeof value === "string" ? value.trim() : ""; return (text || fallback).slice(0, max); }
function safeId(value, fallback = "pet") { const id = safeText(value, fallback, 64).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""); return id || fallback; }

export function createBuddyDocument(displayName = "Buddy", nowMs = Date.now()) {
	return {
		version: BUDDY_DOCUMENT_VERSION,
		buddy: createBuddyState(nowMs, displayName),
		selectedPet: null,
		myPets: [],
		preferences: { showHome: false, homeMode: "idle" },
	};
}

export function normalizeBuddyDocument(value, displayName = "Buddy", nowMs = Date.now()) {
	const fallback = createBuddyDocument(displayName, nowMs);
	if (!isRecord(value) || value.version !== BUDDY_DOCUMENT_VERSION) return fallback;
	const preferences = isRecord(value.preferences) ? value.preferences : {};
	const myPets = Array.isArray(value.myPets) ? value.myPets.map(normalizeMyPet).filter(Boolean).slice(-MAX_MY_PETS) : [];
	const selectedPet = normalizeSelectedPet(value.selectedPet, myPets);
	return {
		version: BUDDY_DOCUMENT_VERSION,
		buddy: normalizeBuddyState(value.buddy, nowMs, displayName),
		selectedPet,
		myPets,
		preferences: {
			showHome: preferences.showHome === true,
			homeMode: preferences.homeMode === "play" ? "play" : "idle",
		},
	};
}

export function normalizeMyPet(value) {
	if (!isRecord(value)) return null;
	const dataUrl = typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/") && value.dataUrl.length <= MAX_MY_PET_DATA_URL_CHARS ? value.dataUrl : "";
	if (!dataUrl) return null;
	return {
		source: "local",
		id: safeId(value.id, "my-pet"),
		displayName: safeText(value.displayName, "My Pet", 60),
		description: safeText(value.description, "Imported pet", 240),
		dataUrl,
		importedAt: Math.max(0, Number.isFinite(value.importedAt) ? Number(value.importedAt) : Date.now()),
	};
}

export function normalizeSelectedPet(value, myPets = []) {
	if (!isRecord(value)) return null;
	if (value.source === "local") {
		const id = safeId(value.id, "my-pet");
		return myPets.find((pet) => pet.id === id) ?? null;
	}
	if (value.source !== "openpets") return null;
	const spriteUrl = safeOpenPetsImageUrl(value.spriteUrl);
	if (!spriteUrl) return null;
	return {
		source: "openpets",
		id: safeId(value.id, "openpet"),
		displayName: safeText(value.displayName, "OpenPet", 60),
		description: safeText(value.description, "OpenPets companion", 240),
		spriteUrl,
	};
}

export function safeOpenPetsImageUrl(value) {
	if (typeof value !== "string" || value.length > 2048) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return null;
		if (url.hostname !== "openpets.dev" && !url.hostname.endsWith(".openpets.dev")) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export async function loadBuddyDocument(displayName = "Buddy", nowMs = Date.now()) {
	return normalizeBuddyDocument(await readRaw(), displayName, nowMs);
}

export async function saveBuddyDocument(documentValue) {
	const normalized = normalizeBuddyDocument(documentValue, documentValue?.buddy?.displayName ?? "Buddy", Date.now());
	await writeRaw(normalized);
	return normalized;
}

async function readRaw() {
	if (hasChromeLocalStorage()) {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.get([BUDDY_STORE_KEY], (result) => resolve(result?.[BUDDY_STORE_KEY] ?? null));
			} catch { resolve(null); }
		});
	}
	if (typeof GM_getValue === "function") {
		try { return await Promise.resolve(GM_getValue(BUDDY_STORE_KEY, null)); } catch { return null; }
	}
	try {
		const raw = localStorage.getItem(BUDDY_STORE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

async function writeRaw(value) {
	if (hasChromeLocalStorage()) {
		await new Promise((resolve, reject) => {
			try {
				chrome.storage.local.set({ [BUDDY_STORE_KEY]: value }, () => {
					if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
					else resolve();
				});
			} catch (error) { reject(error); }
		});
		return;
	}
	if (typeof GM_setValue === "function") {
		await Promise.resolve(GM_setValue(BUDDY_STORE_KEY, value));
		return;
	}
	localStorage.setItem(BUDDY_STORE_KEY, JSON.stringify(value));
}

function hasChromeLocalStorage() {
	return typeof chrome !== "undefined" && Boolean(chrome?.storage?.local);
}
