export const OPENPETS_CATALOG_V3 = "https://openpets.dev/pets/catalog.v3.json";
export const OPENPETS_CATALOG_V2 = "https://openpets.dev/pets/catalog.v2.json";

const MAX_RESPONSE_CHARS = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeText(value, fallback = "", max = 500) { const text = typeof value === "string" ? value.trim() : ""; return (text || fallback).slice(0, max); }
function safeId(value) { const id = safeText(value, "", 64).toLowerCase(); return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? id : null; }

export function safeOpenPetsUrl(value, base = OPENPETS_CATALOG_V3) {
	if (typeof value !== "string" || value.length > 2048) return null;
	try {
		const url = new URL(value, base);
		if (url.protocol !== "https:") return null;
		if (url.hostname !== "openpets.dev" && !url.hostname.endsWith(".openpets.dev")) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function normalizeOpenPetsPet(value, base = OPENPETS_CATALOG_V3) {
	if (!isRecord(value)) return null;
	const id = safeId(value.id);
	const displayName = safeText(value.displayName ?? value.name, "", 80);
	const spriteUrl = safeOpenPetsUrl(value.spritesheet ?? value.preview ?? value.thumbnail, base);
	if (!id || !displayName || !spriteUrl) return null;
	return {
		source: "openpets",
		id,
		displayName,
		description: safeText(value.description, "OpenPets companion", 500),
		spriteUrl,
		thumbnailUrl: safeOpenPetsUrl(value.thumbnail ?? value.preview ?? value.spritesheet, base) ?? spriteUrl,
		category: safeText(value.category, "", 40),
		featured: value.featured === true,
		original: value.original === true,
	};
}

export function validateCatalogV3Index(value, base = OPENPETS_CATALOG_V3) {
	if (!isRecord(value) || value.version !== 3 || !Array.isArray(value.pages)) throw new Error("OpenPets catalog v3 index is invalid.");
	const pages = value.pages.map((page) => {
		const candidate = typeof page === "string" ? page : isRecord(page) ? page.url ?? page.href : null;
		return safeOpenPetsUrl(candidate, base);
	}).filter(Boolean);
	if (pages.length === 0 && Number(value.total ?? 0) > 0) throw new Error("OpenPets catalog v3 has no valid page URLs.");
	return { version: 3, generatedAt: safeText(value.generatedAt, "", 80), total: Math.max(0, Number.isFinite(value.total) ? Number(value.total) : 0), pages };
}

export function validateCatalogV3Page(value, base) {
	if (!isRecord(value)) throw new Error("OpenPets catalog page is invalid.");
	const entries = Array.isArray(value.pets) ? value.pets : Array.isArray(value.items) ? value.items : [];
	return entries.map((entry) => normalizeOpenPetsPet(entry, base)).filter(Boolean);
}

export function validateCatalogV2(value, base = OPENPETS_CATALOG_V2) {
	if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.pets)) throw new Error("OpenPets catalog v2 is invalid.");
	return value.pets.map((entry) => normalizeOpenPetsPet(entry, base)).filter(Boolean);
}

export class OpenPetsCatalogClient {
	constructor(fetchImpl = globalThis.fetch?.bind(globalThis)) {
		if (typeof fetchImpl !== "function") throw new Error("OpenPets catalog fetch is unavailable.");
		this.fetchImpl = fetchImpl;
		this.mode = "uninitialized";
		this.pages = [];
		this.nextPageIndex = 0;
		this.petsById = new Map();
		this.total = 0;
	}

	get pets() { return [...this.petsById.values()]; }
	get loadedCount() { return this.petsById.size; }
	get hasMore() { return this.mode === "v3" && this.nextPageIndex < this.pages.length; }

	async initialize() {
		if (this.mode !== "uninitialized") return this.snapshot();
		try {
			const index = validateCatalogV3Index(await fetchJson(this.fetchImpl, OPENPETS_CATALOG_V3), OPENPETS_CATALOG_V3);
			this.mode = "v3";
			this.pages = index.pages;
			this.total = index.total;
			if (this.pages.length > 0) await this.loadNextPage();
			return this.snapshot();
		} catch (v3Error) {
			try {
				const pets = validateCatalogV2(await fetchJson(this.fetchImpl, OPENPETS_CATALOG_V2), OPENPETS_CATALOG_V2);
				this.mode = "v2";
				this.total = pets.length;
				this.addPets(pets);
				return this.snapshot();
			} catch (v2Error) {
				this.mode = "error";
				const message = v3Error instanceof Error ? v3Error.message : String(v3Error);
				throw new Error(`Could not load OpenPets catalog: ${message}`);
			}
		}
	}

	async loadNextPage() {
		if (this.mode === "uninitialized") return this.initialize();
		if (this.mode !== "v3" || !this.hasMore) return this.snapshot();
		const pageUrl = this.pages[this.nextPageIndex++];
		const pets = validateCatalogV3Page(await fetchJson(this.fetchImpl, pageUrl), pageUrl);
		this.addPets(pets);
		return this.snapshot();
	}

	async loadAll(maxPages = 100) {
		if (this.mode === "uninitialized") await this.initialize();
		let pages = 0;
		while (this.hasMore && pages < maxPages) {
			await this.loadNextPage();
			pages += 1;
		}
		return this.snapshot();
	}

	addPets(pets) {
		for (const pet of pets) this.petsById.set(pet.id, pet);
	}

	snapshot() {
		return { mode: this.mode, pets: this.pets, loadedCount: this.loadedCount, total: this.total || this.loadedCount, hasMore: this.hasMore };
	}
}

async function fetchJson(fetchImpl, url) {
	const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
	const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
	try {
		const response = await fetchImpl(url, { method: "GET", credentials: "omit", redirect: "follow", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
		if (!response?.ok) throw new Error(`OpenPets returned HTTP ${response?.status ?? "error"}.`);
		const text = await response.text();
		if (text.length > MAX_RESPONSE_CHARS) throw new Error("OpenPets catalog response is too large.");
		return JSON.parse(text);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
