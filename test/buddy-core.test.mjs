import test from "node:test";
import assert from "node:assert/strict";

import {
	advanceBuddyState,
	applyBuddyCare,
	buddySnapshot,
	createBuddyState,
	talkToBuddy,
	trainBuddy,
} from "../src/buddy-core.js";

const HOUR = 60 * 60 * 1000;

test("Buddy needs drift with time and care relieves the right pressure", () => {
	const start = createBuddyState(1_000, "Pixel");
	const later = advanceBuddyState(start, 1_000 + 4 * HOUR);
	assert.ok(later.needs.hunger > start.needs.hunger);
	assert.ok(later.needs.play > start.needs.play);
	const fed = applyBuddyCare(later, "feed", 1_000 + 4 * HOUR);
	assert.ok(fed.needs.hunger < later.needs.hunger);
	assert.ok(fed.affection > later.affection);
	assert.equal(fed.lastCareAction, "feed");
});

test("training changes personality, count, xp and level deterministically", () => {
	let buddy = createBuddyState(2_000, "Pixel");
	for (let index = 0; index < 13; index += 1) buddy = trainBuddy(buddy, "curiosity", 2_000 + index);
	assert.equal(buddy.training.curiosity, 13);
	assert.ok(buddy.personality.curiosity > 0.65);
	assert.ok(buddy.xp >= 100);
	assert.ok(buddy.level >= 2);
});

test("talk keeps bounded history and lowers social pressure", () => {
	let buddy = createBuddyState(3_000, "Pixel");
	const before = buddy.needs.social;
	for (let index = 0; index < 30; index += 1) buddy = talkToBuddy(buddy, `hello ${index}`, 3_000 + index).state;
	assert.ok(buddy.messages.length <= 40);
	assert.ok(buddy.needs.social < before);
	assert.equal(buddy.messages.at(-1).role, "buddy");
});

test("snapshot exposes the canonical public Buddy view", () => {
	const buddy = applyBuddyCare(createBuddyState(4_000, "Pixel"), "play", 4_000);
	const snapshot = buddySnapshot(buddy, 4_000);
	assert.equal(snapshot.displayName, "Pixel");
	assert.equal(typeof snapshot.mood, "string");
	assert.equal(typeof snapshot.dominantNeed, "string");
	assert.equal(snapshot.level, 1);
});
