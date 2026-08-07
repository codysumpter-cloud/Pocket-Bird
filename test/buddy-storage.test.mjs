import test from "node:test";
import assert from "node:assert/strict";

import {
	MAX_MY_PET_DATA_URL_CHARS,
	createBuddyDocument,
	normalizeBuddyDocument,
	normalizeMyPet,
	safeOpenPetsImageUrl,
} from "../src/buddy-storage.js";

test("Buddy document keeps Home optional by default", () => {
	const document = createBuddyDocument("Pixel", 1000);
	assert.equal(document.buddy.displayName, "Pixel");
	assert.equal(document.preferences.showHome, false);
	assert.equal(document.preferences.homeMode, "idle");
});

test("My Pets accepts bounded image data URLs and rejects oversized assets", () => {
	const pet = normalizeMyPet({ id: "Ani Human", displayName: "Ani Human", dataUrl: "data:image/webp;base64,AAAA" });
	assert.equal(pet.id, "ani-human");
	assert.equal(normalizeMyPet({ id: "huge", displayName: "Huge", dataUrl: "data:image/png;base64," + "x".repeat(MAX_MY_PET_DATA_URL_CHARS) }), null);
});

test("remote selected pets are confined to OpenPets image hosts", () => {
	assert.equal(safeOpenPetsImageUrl("https://openpets.dev/pets/a/spritesheet.webp"), "https://openpets.dev/pets/a/spritesheet.webp");
	assert.equal(safeOpenPetsImageUrl("https://evil.example/pet.webp"), null);
});

test("normalization keeps selected local pet tied to My Pets library", () => {
	const local = normalizeMyPet({ id: "cat", displayName: "Cat", dataUrl: "data:image/png;base64,AAAA" });
	const normalized = normalizeBuddyDocument({
		version: 1,
		buddy: createBuddyDocument("Pixel", 1000).buddy,
		myPets: [local],
		selectedPet: { source: "local", id: "cat" },
		preferences: { showHome: true, homeMode: "play" },
	}, "Pixel", 1000);
	assert.equal(normalized.selectedPet.id, "cat");
	assert.equal(normalized.preferences.showHome, true);
	assert.equal(normalized.preferences.homeMode, "play");
});
