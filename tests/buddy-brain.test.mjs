import test from "node:test";
import assert from "node:assert/strict";
import { createBuddyBrain, cleanBuddyState, applyBuddyDecay, getBuddyMood } from "../src/buddy/brain.js";
import { PRISMTEK_PACK_RECIPES } from "../src/buddy/pet-recipes.js";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async getJson(key, fallback = null) { return map.has(key) ? structuredClone(map.get(key)) : fallback; },
    async setJson(key, value) { map.set(key, structuredClone(value)); },
  };
}

test("Buddy Brain loads a durable v3 state and care mutates the same owner", async () => {
  const brain = createBuddyBrain(memoryStorage());
  const initial = await brain.load();
  assert.equal(initial.version, 3);
  assert.equal(initial.brain.schema, "pocket-buddy-brain-v1");
  const before = initial.lifecycle.hunger;
  const result = await brain.care("feed", 1_000_000);
  assert.ok(result.snapshot.lifecycle.hunger >= before);
  assert.equal(result.snapshot.careCounts.fed, 1);
  assert.equal(result.snapshot.brain.actionCounts.feed, 1);
});

test("decay lowers awake needs but never kills a Buddy in safe lifecycle mode", () => {
  const now = Date.now();
  const state = cleanBuddyState({ hunger: 20, energy: 20, happiness: 20, affection: 20, health: 5, lastSeenAt: now - 72 * 60 * 60 * 1000 }, now - 72 * 60 * 60 * 1000);
  const next = applyBuddyDecay(state, 72 * 60 * 60 * 1000, now, false);
  assert.equal(next.deadAt, 0);
  assert.ok(next.health >= 10);
  assert.ok(["sick", "dirty", "hungry", "tired", "bored", "content", "happy", "sleeping"].includes(getBuddyMood(next, now)));
});

test("canonical Prismtek PixelLab recipes are exact and non-substitutable", () => {
  const expected = new Map([
    ["Balinese_Cat-2.zip", [60, 60, "87a63f2f1a540ef06c0f6684cbf7026e869211857091d07b6219dac17ad0f657"]],
    ["Shiba_Inu-2.zip", [56, 56, "e76cc58d2a5b776c0f8ba1ebd4d9b7dd3c31833a994e75603deccfa1393eecf7"]],
    ["A_stout_vibrant_green_T-Rex_with_a_rounded_chunky-2.zip", [116, 116, "a50f9f0a4beab34f035c332de7b8bd1055eef543d20d676c8c6b0da06d7458c8"]],
    ["Ani_Iso_Human.zip", [100, 100, "411deb03312a4bbc2dd39ccad069fa143e38184e409819d8a0a23001baef5723"]],
  ]);
  assert.equal(PRISMTEK_PACK_RECIPES.length, 4);
  for (const recipe of PRISMTEK_PACK_RECIPES) {
    const exact = expected.get(recipe.archiveName);
    assert.ok(exact, `unexpected recipe ${recipe.archiveName}`);
    assert.deepEqual([recipe.width, recipe.height, recipe.sha256], exact);
  }
});
