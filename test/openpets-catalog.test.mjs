import test from "node:test";
import assert from "node:assert/strict";

import {
	OpenPetsCatalogClient,
	normalizeOpenPetsPet,
	validateCatalogV3Index,
} from "../src/openpets-catalog.js";

test("OpenPets entry normalization accepts only safe OpenPets image URLs", () => {
	const pet = normalizeOpenPetsPet({ id: "pixel-cat", displayName: "Pixel Cat", description: "cat", spritesheet: "https://openpets.dev/pets/pixel-cat/spritesheet.webp" });
	assert.equal(pet.id, "pixel-cat");
	assert.equal(pet.displayName, "Pixel Cat");
	assert.equal(normalizeOpenPetsPet({ id: "bad", displayName: "Bad", spritesheet: "http://example.com/pet.webp" }), null);
});

test("catalog v3 index resolves relative page URLs", () => {
	const index = validateCatalogV3Index({ version: 3, total: 1, pages: ["catalog.v3/page-000.json"] });
	assert.equal(index.pages[0], "https://openpets.dev/pets/catalog.v3/page-000.json");
});

test("client pages through v3 without duplicating pets", async () => {
	const responses = new Map([
		["https://openpets.dev/pets/catalog.v3.json", { version: 3, total: 2, pages: ["https://openpets.dev/pets/catalog.v3/page-000.json", "https://openpets.dev/pets/catalog.v3/page-001.json"] }],
		["https://openpets.dev/pets/catalog.v3/page-000.json", { pets: [{ id: "one", displayName: "One", spritesheet: "https://openpets.dev/pets/one/spritesheet.webp" }] }],
		["https://openpets.dev/pets/catalog.v3/page-001.json", { pets: [{ id: "one", displayName: "One", spritesheet: "https://openpets.dev/pets/one/spritesheet.webp" }, { id: "two", displayName: "Two", spritesheet: "https://openpets.dev/pets/two/spritesheet.webp" }] }],
	]);
	const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(responses.get(url)) });
	const client = new OpenPetsCatalogClient(fetchImpl);
	await client.initialize();
	assert.equal(client.loadedCount, 1);
	assert.equal(client.hasMore, true);
	await client.loadAll();
	assert.equal(client.loadedCount, 2);
	assert.equal(client.hasMore, false);
});

test("client falls back to v2 when v3 fails", async () => {
	const fetchImpl = async (url) => {
		if (url.endsWith("catalog.v3.json")) return { ok: false, status: 503, text: async () => "" };
		return { ok: true, status: 200, text: async () => JSON.stringify({ version: 2, pets: [{ id: "fallback", displayName: "Fallback", preview: "https://openpets.dev/pets/fallback/spritesheet.webp", zip: "https://zip.openpets.dev/pets/fallback.zip" }] }) };
	};
	const client = new OpenPetsCatalogClient(fetchImpl);
	const snapshot = await client.initialize();
	assert.equal(snapshot.mode, "v2");
	assert.equal(snapshot.pets[0].id, "fallback");
});
