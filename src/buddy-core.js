export const BUDDY_SCHEMA_VERSION = 1;

export const BUDDY_NEEDS = Object.freeze(["hunger", "energy", "social", "play", "comfort", "cleanliness"]);
export const BUDDY_CARE_ACTIONS = Object.freeze(["pet", "feed", "play", "rest", "clean"]);
export const BUDDY_TRAINING_TRAITS = Object.freeze(["sociability", "curiosity", "playfulness", "diligence", "bravery", "affection", "independence", "patience", "creativity"]);

const HOUR_MS = 60 * 60 * 1000;
const MAX_CATCHUP_MS = 7 * 24 * HOUR_MS;
const MESSAGE_LIMIT = 40;

const NEED_DRIFT_PER_HOUR = Object.freeze({ hunger: 0.035, energy: 0.022, social: 0.018, play: 0.026, comfort: 0.010, cleanliness: 0.014 });
const DEFAULT_NEEDS = Object.freeze({ hunger: 0.15, energy: 0.12, social: 0.18, play: 0.20, comfort: 0.10, cleanliness: 0.05 });
const DEFAULT_PERSONALITY = Object.freeze({ sociability: 0.55, curiosity: 0.65, playfulness: 0.60, diligence: 0.55, bravery: 0.45, affection: 0.65, independence: 0.45, patience: 0.55, creativity: 0.60 });

const CARE_EFFECTS = Object.freeze({
	pet: { needs: { social: -0.18, comfort: -0.08 }, affection: 0.020, xp: 4, activity: "socializing" },
	feed: { needs: { hunger: -0.55, comfort: -0.05 }, affection: 0.010, xp: 5, activity: "eating" },
	play: { needs: { play: -0.48, social: -0.08, energy: 0.07 }, affection: 0.015, xp: 6, activity: "playing" },
	rest: { needs: { energy: -0.58, comfort: -0.15 }, affection: 0.006, xp: 4, activity: "sleeping" },
	clean: { needs: { cleanliness: -0.65, comfort: -0.08 }, affection: 0.008, xp: 5, activity: "grooming" },
});

function clamp01(value, fallback = 0) { const n = Number.isFinite(value) ? Number(value) : fallback; return Math.min(1, Math.max(0, n)); }
function safeNumber(value, fallback = 0) { return Number.isFinite(value) ? Number(value) : fallback; }
function safeTimestamp(value, fallback) { return Math.max(0, safeNumber(value, fallback)); }
function safeText(value, fallback = "", max = 240) { const text = typeof value === "string" ? value.trim() : ""; return (text || fallback).slice(0, max); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function levelForXp(xp) { return Math.max(1, 1 + Math.floor(Math.max(0, xp) / 100)); }

function normalizeNeeds(value) {
	const source = isRecord(value) ? value : {};
	return Object.fromEntries(BUDDY_NEEDS.map((need) => [need, clamp01(source[need], DEFAULT_NEEDS[need])]));
}
function normalizePersonality(value) {
	const source = isRecord(value) ? value : {};
	return Object.fromEntries(BUDDY_TRAINING_TRAITS.map((trait) => [trait, clamp01(source[trait], DEFAULT_PERSONALITY[trait])]));
}
function normalizeTraining(value) {
	const source = isRecord(value) ? value : {};
	return Object.fromEntries(BUDDY_TRAINING_TRAITS.map((trait) => [trait, Math.max(0, Math.floor(safeNumber(source[trait], 0)))]));
}
function normalizeMessages(value) {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((entry) => ({ role: entry.role === "user" ? "user" : "buddy", text: safeText(entry.text, "", 500), at: safeTimestamp(entry.at, 0) })).filter((entry) => entry.text).slice(-MESSAGE_LIMIT);
}
function dominantNeedUnsafe(state) { return BUDDY_NEEDS.reduce((best, need) => state.needs[need] > state.needs[best] ? need : best, BUDDY_NEEDS[0]); }
function buddyMoodUnsafe(state) {
	const need = dominantNeedUnsafe(state); const pressure = state.needs[need];
	if (pressure >= 0.90) return "distressed";
	if (state.needs.energy >= 0.78) return "sleepy";
	if (state.needs.hunger >= 0.78) return "hungry";
	if (state.needs.cleanliness >= 0.80) return "grubby";
	if (state.needs.social >= 0.72) return "lonely";
	if (state.needs.play >= 0.72) return "bored";
	if (state.affection >= 0.80 && pressure < 0.45) return "adoring";
	if (pressure < 0.25) return "happy";
	return "content";
}
function withDerived(value, nowMs = value.updatedAtMs) {
	const state = { ...value, updatedAtMs: safeTimestamp(nowMs, value.updatedAtMs) };
	state.level = levelForXp(state.xp); state.dominantNeed = dominantNeedUnsafe(state); state.mood = buddyMoodUnsafe(state); return state;
}

export function createBuddyState(nowMs = Date.now(), displayName = "Buddy") {
	const now = safeTimestamp(nowMs, Date.now());
	return withDerived({ schemaVersion: BUDDY_SCHEMA_VERSION, displayName: safeText(displayName, "Buddy", 40), createdAtMs: now, updatedAtMs: now, affection: 0.50, xp: 0, level: 1, needs: { ...DEFAULT_NEEDS }, personality: { ...DEFAULT_PERSONALITY }, training: Object.fromEntries(BUDDY_TRAINING_TRAITS.map((trait) => [trait, 0])), lastCareAction: null, lastCareAtMs: 0, activity: "idle", messages: [{ role: "buddy", text: "Hey! I’m right here.", at: now }] });
}

export function normalizeBuddyState(value, nowMs = Date.now(), displayName = "Buddy") {
	if (!isRecord(value) || value.schemaVersion !== BUDDY_SCHEMA_VERSION) return createBuddyState(nowMs, displayName);
	const createdAtMs = safeTimestamp(value.createdAtMs, nowMs); const updatedAtMs = Math.max(createdAtMs, safeTimestamp(value.updatedAtMs, createdAtMs)); const xp = Math.max(0, Math.floor(safeNumber(value.xp, 0)));
	return withDerived({ schemaVersion: BUDDY_SCHEMA_VERSION, displayName: safeText(value.displayName, displayName, 40), createdAtMs, updatedAtMs, affection: clamp01(value.affection, 0.50), xp, level: levelForXp(xp), needs: normalizeNeeds(value.needs), personality: normalizePersonality(value.personality), training: normalizeTraining(value.training), lastCareAction: BUDDY_CARE_ACTIONS.includes(value.lastCareAction) ? value.lastCareAction : null, lastCareAtMs: safeTimestamp(value.lastCareAtMs, 0), activity: typeof value.activity === "string" ? value.activity.slice(0, 40) : "idle", messages: normalizeMessages(value.messages) });
}

export function advanceBuddyState(value, nowMs = Date.now()) {
	const current = normalizeBuddyState(value, nowMs, value?.displayName ?? "Buddy"); const now = Math.max(current.updatedAtMs, safeTimestamp(nowMs, current.updatedAtMs)); const elapsedMs = Math.min(MAX_CATCHUP_MS, Math.max(0, now - current.updatedAtMs));
	if (elapsedMs === 0) return withDerived(current, now);
	const elapsedHours = elapsedMs / HOUR_MS; const needs = { ...current.needs };
	for (const need of BUDDY_NEEDS) needs[need] = clamp01(needs[need] + NEED_DRIFT_PER_HOUR[need] * elapsedHours);
	return withDerived({ ...current, needs, activity: current.lastCareAtMs > 0 && now - current.lastCareAtMs < 120000 ? current.activity : "idle", updatedAtMs: now }, now);
}

export function applyBuddyCare(value, action, nowMs = Date.now()) {
	if (!BUDDY_CARE_ACTIONS.includes(action)) throw new Error(`Unknown Buddy care action: ${action}`);
	const current = advanceBuddyState(value, nowMs); const effect = CARE_EFFECTS[action]; const needs = { ...current.needs };
	for (const [need, delta] of Object.entries(effect.needs)) needs[need] = clamp01(needs[need] + delta);
	const xp = current.xp + effect.xp;
	return withDerived({ ...current, needs, affection: clamp01(current.affection + effect.affection), xp, level: levelForXp(xp), lastCareAction: action, lastCareAtMs: current.updatedAtMs, activity: effect.activity });
}

export function trainBuddy(value, trait, nowMs = Date.now()) {
	if (!BUDDY_TRAINING_TRAITS.includes(trait)) throw new Error(`Unknown Buddy training trait: ${trait}`);
	const current = advanceBuddyState(value, nowMs); const personality = { ...current.personality, [trait]: clamp01(current.personality[trait] + 0.025) }; const training = { ...current.training, [trait]: current.training[trait] + 1 }; const xp = current.xp + 8;
	return withDerived({ ...current, personality, training, xp, level: levelForXp(xp), needs: { ...current.needs, play: clamp01(current.needs.play - 0.08), social: clamp01(current.needs.social - 0.04) }, activity: "training", lastCareAtMs: current.updatedAtMs });
}

export function dominantBuddyNeed(value) { return dominantNeedUnsafe(normalizeBuddyState(value, Date.now(), value?.displayName ?? "Buddy")); }
export function buddyMood(value) { return buddyMoodUnsafe(normalizeBuddyState(value, Date.now(), value?.displayName ?? "Buddy")); }

export function buddySnapshot(value, nowMs = Date.now()) {
	const state = advanceBuddyState(value, nowMs); const dominantNeed = dominantNeedUnsafe(state);
	return { displayName: state.displayName, mood: buddyMoodUnsafe(state), activity: state.activity, dominantNeed, dominantPressure: state.needs[dominantNeed], affection: state.affection, level: state.level, xp: state.xp, ageMs: Math.max(0, state.updatedAtMs - state.createdAtMs), needs: { ...state.needs }, personality: { ...state.personality }, training: { ...state.training } };
}

export function talkToBuddy(value, message, nowMs = Date.now()) {
	const cleanMessage = safeText(message, "", 500); if (!cleanMessage) return { state: advanceBuddyState(value, nowMs), reply: "" };
	let current = advanceBuddyState(value, nowMs); const reply = localBuddyReply(current, cleanMessage); const messages = [...current.messages, { role: "user", text: cleanMessage, at: current.updatedAtMs }, { role: "buddy", text: reply, at: current.updatedAtMs }].slice(-MESSAGE_LIMIT);
	current = withDerived({ ...current, messages, affection: clamp01(current.affection + 0.004), needs: { ...current.needs, social: clamp01(current.needs.social - 0.10) }, activity: "socializing", lastCareAtMs: current.updatedAtMs });
	return { state: current, reply };
}

function localBuddyReply(state, message) {
	const lower = message.toLowerCase();
	if (/\b(hello|hey|hi|yo)\b/.test(lower)) return "Hey! What are we getting into?";
	if (/\b(love|best friend)\b/.test(lower)) return "Heck yeah. I’m sticking with you.";
	if (/\b(food|hungry|eat|snack)\b/.test(lower)) return state.needs.hunger > 0.45 ? "Snacks would be extremely scientifically important right now." : "I’m good on snacks, but I respect the snack agenda.";
	if (/\b(sleep|tired|nap|rest)\b/.test(lower)) return state.needs.energy > 0.45 ? "A tiny nap sounds perfect." : "I’ve still got some zoomies left.";
	if (/\b(play|game|fun)\b/.test(lower)) return state.needs.play > 0.45 ? "Yes. Game time. This is not negotiable." : "I’m always up for a little chaos.";
	const replies = { hunger: "I’m listening. Also, unrelated: I have been thinking about snacks.", energy: "I’m with you. I may also be entering tiny sleepy creature territory.", social: "Keep talking. I like hanging out with you.", play: "I hear you. We should probably do something fun soon too.", comfort: "I’m listening. A cozy spot would make this even better.", cleanliness: "Yep. Also I may have gotten a little scruffy somehow." };
	return replies[dominantNeedUnsafe(state)] ?? "I’m right here.";
}
