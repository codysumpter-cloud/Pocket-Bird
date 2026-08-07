export const BUDDY_BRAIN_STATE_VERSION = 3;
const STATE_KEY = "brain.state.v3";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_CATCHUP_MS = 30 * DAY_MS;
const MESS_INTERVAL_MS = 4 * HOUR_MS;

export const DEFAULT_PERSONALITY = Object.freeze({
  sociability: 0.55,
  curiosity: 0.65,
  playfulness: 0.6,
  diligence: 0.55,
  bravery: 0.45,
  affection: 0.65,
  independence: 0.45,
  patience: 0.55,
  aggression: 0.2,
  creativity: 0.6,
  neatness: 0.5,
});

export const DEFAULT_DRIVES = Object.freeze({
  hunger: 0.15,
  energy: 0.1,
  comfort: 0.1,
  safety: 0.05,
  boredom: 0.2,
  curiosity: 0.25,
  affection: 0.15,
  social: 0.15,
  accomplishment: 0.2,
  cleanliness: 0.05,
  focus: 0.15,
});

export const DEFAULT_RELATIONSHIP = Object.freeze({ affection: 0.5, trust: 0.5, familiarity: 0.1, respect: 0.4 });

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value, fallback = 0) { return clamp(Number.isFinite(value) ? value : fallback, 0, 1); }
function finite(value, fallback) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function integer(value, fallback = 0) { return Math.max(0, Math.floor(finite(value, fallback))); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value, fallback = "", maximum = 500) {
  const result = typeof value === "string" ? value.trim() : "";
  return (result || fallback).slice(0, maximum);
}
function stringArray(value, maximum = 100, itemMaximum = 500) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, itemMaximum)).filter(Boolean).slice(-maximum) : [];
}
function numericMap(source, defaults) {
  const current = isRecord(source) ? source : {};
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, clamp01(current[key], fallback)]));
}
function careCounts(value = {}) {
  const current = isRecord(value) ? value : {};
  return {
    fed: integer(current.fed), played: integer(current.played), petted: integer(current.petted),
    napped: integer(current.napped), cleaned: integer(current.cleaned), medicated: integer(current.medicated), restarted: integer(current.restarted),
  };
}

function defaultBrain(currentAffection = 50) {
  return {
    schema: "pocket-buddy-brain-v1",
    buddyId: "primary-buddy",
    displayName: "Buddy",
    personality: { ...DEFAULT_PERSONALITY },
    drives: { ...DEFAULT_DRIVES },
    relationship: { ...DEFAULT_RELATIONSHIP, affection: clamp01(currentAffection / 100, 0.5) },
    stats: { skillPoints: 0, rerolls: 1, strength: 1, defense: 1, speed: 1, focus: 1 },
    notes: [], tasks: [],
    messages: [{ role: "buddy", text: "Hey! I’m here whenever you need me.", at: 0 }],
    trainingCounts: {}, learnedAssociations: {}, actionCounts: {}, lastActions: [], workingMemory: [], inventory: {},
    customization: { wardrobe: "classic" },
  };
}

function cleanTasks(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((task, index) => ({
    id: text(task.id, `task-${index + 1}`, 80), text: text(task.text, "", 240), completed: task.completed === true, createdAt: Math.max(0, finite(task.createdAt, 0)),
  })).filter((task) => task.text).slice(-100);
}
function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((message) => ({
    role: message.role === "user" ? "user" : "buddy", text: text(message.text, "", 500), at: Math.max(0, finite(message.at, 0)),
  })).filter((message) => message.text).slice(-80);
}
function cleanWorkingMemory(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({ action: text(entry.action, "", 64), at: Math.max(0, finite(entry.at, 0)) })).filter((entry) => entry.action).slice(-32);
}

function cleanBrain(value, lifecycle) {
  const source = isRecord(value) ? value : {};
  const fallback = defaultBrain(lifecycle.affection);
  const relationship = numericMap(source.relationship, { ...DEFAULT_RELATIONSHIP, affection: lifecycle.affection / 100 });
  relationship.affection = clamp01(lifecycle.affection / 100, relationship.affection);
  const stats = isRecord(source.stats) ? source.stats : {};
  const actionCountsSource = isRecord(source.actionCounts) ? source.actionCounts : {};
  const actionCounts = Object.fromEntries(Object.entries(actionCountsSource).filter(([key, count]) => /^[A-Za-z0-9._:-]{1,64}$/.test(key) && Number.isFinite(count)).map(([key, count]) => [key, integer(count)]).slice(0, 100));
  const trainingSource = isRecord(source.trainingCounts) ? source.trainingCounts : {};
  const trainingCounts = Object.fromEntries(Object.entries(trainingSource).filter(([key, count]) => key in DEFAULT_PERSONALITY && Number.isFinite(count)).map(([key, count]) => [key, integer(count)]));
  const messages = cleanMessages(source.messages);
  return {
    schema: "pocket-buddy-brain-v1",
    buddyId: text(source.buddyId, fallback.buddyId, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "primary-buddy",
    displayName: text(source.displayName, fallback.displayName, 64),
    personality: numericMap(source.personality, DEFAULT_PERSONALITY),
    drives: numericMap(source.drives, DEFAULT_DRIVES), relationship,
    stats: {
      skillPoints: integer(stats.skillPoints), rerolls: integer(stats.rerolls, 1), strength: Math.max(1, finite(stats.strength, 1)),
      defense: Math.max(1, finite(stats.defense, 1)), speed: Math.max(1, finite(stats.speed, 1)), focus: Math.max(1, finite(stats.focus, 1)),
    },
    notes: stringArray(source.notes, 100, 500), tasks: cleanTasks(source.tasks), messages: messages.length ? messages : fallback.messages,
    trainingCounts, learnedAssociations: isRecord(source.learnedAssociations) ? structuredClone(source.learnedAssociations) : {}, actionCounts,
    lastActions: stringArray(source.lastActions, 16, 64), workingMemory: cleanWorkingMemory(source.workingMemory),
    inventory: isRecord(source.inventory) ? structuredClone(source.inventory) : {},
    customization: { wardrobe: text(source.customization?.wardrobe, "classic", 40) },
  };
}

function synchronizeBrain(state) {
  const brain = cleanBrain(state.brain, state);
  brain.relationship.affection = clamp01(state.affection / 100, brain.relationship.affection);
  brain.drives.hunger = clamp01((100 - state.hunger) / 100);
  brain.drives.energy = clamp01((100 - state.energy) / 100);
  brain.drives.boredom = clamp01((100 - state.happiness) / 100);
  brain.drives.cleanliness = clamp01(state.mess / 5);
  brain.drives.affection = clamp01((100 - state.affection) / 100);
  brain.stats.level = state.level; brain.stats.experience = state.xp; brain.stats.health = state.health; brain.stats.maxHealth = 100;
  brain.stats.stamina = state.energy; brain.stats.maxStamina = 100;
  return brain;
}

export function cleanBuddyState(value = {}, now = Date.now()) {
  const current = isRecord(value) ? value : {};
  const lifecycle = {
    version: BUDDY_BRAIN_STATE_VERSION,
    hunger: clamp(finite(current.hunger, 80), 0, 100), energy: clamp(finite(current.energy, 80), 0, 100),
    happiness: clamp(finite(current.happiness, 80), 0, 100), affection: clamp(finite(current.affection, 50), 0, 100),
    health: clamp(finite(current.health, 100), 0, 100), mess: clamp(integer(current.mess), 0, 5),
    messProgressMs: clamp(finite(current.messProgressMs, 0), 0, MESS_INTERVAL_MS - 1), isSick: current.isSick === true,
    medicineDoses: clamp(integer(current.medicineDoses), 0, 1), careMistakes: integer(current.careMistakes),
    bornAt: Math.max(0, finite(current.bornAt, now)), stage: ["hatchling", "growing", "companion", "beloved"].includes(current.stage) ? current.stage : "hatchling",
    deadAt: Math.max(0, finite(current.deadAt, 0)), deathReason: ["", "neglect", "sickness"].includes(current.deathReason) ? current.deathReason : "",
    level: Math.max(1, integer(current.level, 1)), xp: integer(current.xp), careCounts: careCounts(current.careCounts),
    lastSeenAt: Math.max(0, finite(current.lastSeenAt, now)), sleptUntil: Math.max(0, finite(current.sleptUntil, 0)), lastActionAt: Math.max(0, finite(current.lastActionAt, 0)),
    brain: null,
  };
  lifecycle.brain = synchronizeBrain({ ...lifecycle, brain: current.brain });
  return lifecycle;
}

export function getBuddyMood(state, now = Date.now()) {
  if (state.deadAt > 0) return "dead";
  if (state.isSick) return "sick";
  if (state.mess >= 3) return "dirty";
  if (now < state.sleptUntil) return "sleeping";
  if (state.hunger < 30) return "hungry";
  if (state.energy < 30) return "tired";
  if (state.happiness < 30) return "bored";
  if ((state.hunger + state.energy + state.happiness + state.affection) / 4 >= 75) return "happy";
  return "content";
}

export function dominantNeed(state) {
  const scores = [
    ["food", 100 - state.hunger], ["sleep", 100 - state.energy], ["play", 100 - state.happiness], ["love", 100 - state.affection], ["clean", state.mess * 20],
  ];
  return scores.sort((a, b) => b[1] - a[1])[0][0];
}

export function resolveBuddyStage(state, now = Date.now()) {
  const ageMs = Math.max(0, now - (state.bornAt || now));
  if (state.level >= 10 && state.affection >= 85 && state.careMistakes <= 2) return "beloved";
  if (ageMs >= 7 * DAY_MS && state.level >= 5) return "companion";
  if (ageMs >= DAY_MS || state.level >= 3) return "growing";
  return "hatchling";
}

function addXp(state, amount) {
  let xp = state.xp + amount, level = state.level, leveledUp = false;
  while (xp >= level * 50) { xp -= level * 50; level += 1; leveledUp = true; }
  return { xp, level, leveledUp };
}

export function applyBuddyDecay(state, elapsedMs, now = Date.now(), classicLifecycle = false) {
  const current = cleanBuddyState(state, now);
  if (current.deadAt > 0) return current;
  const bounded = clamp(finite(elapsedMs, 0), 0, MAX_CATCHUP_MS);
  const lastSeen = current.lastSeenAt || Math.max(0, now - bounded);
  const sleepMs = Math.min(bounded, current.sleptUntil > lastSeen ? Math.max(0, Math.min(current.sleptUntil, now) - lastSeen) : 0);
  const wakeMs = Math.max(0, bounded - sleepMs), sleepHours = sleepMs / HOUR_MS, wakeHours = wakeMs / HOUR_MS, totalHours = bounded / HOUR_MS;
  const hunger = clamp(current.hunger - wakeHours * 2 - sleepHours * 2, 0, 100);
  const energy = clamp(current.energy - wakeHours * 3 + sleepHours * 15, 0, 100);
  const happiness = clamp(current.happiness - wakeHours * 2 - sleepHours * 0.5, 0, 100);
  const affection = clamp(current.affection - wakeHours, 0, 100);
  const totalMess = current.messProgressMs + wakeMs, messGain = Math.floor(totalMess / MESS_INTERVAL_MS), mess = clamp(current.mess + messGain, 0, 5);
  const messProgressMs = totalMess % MESS_INTERVAL_MS;
  const critical = hunger <= 0 || energy <= 0 || happiness <= 0;
  const sicknessTriggered = mess >= 4 || (hunger <= 0 && happiness <= 0);
  const isSick = current.isSick || sicknessTriggered;
  let health = current.health;
  if (current.isSick) health -= totalHours * 4;
  else if (sicknessTriggered) health -= Math.min(totalHours, 6) * 4;
  if (mess >= 3) health -= totalHours;
  if (hunger <= 0) health -= wakeHours * 2;
  if (happiness <= 0) health -= wakeHours;
  if (energy <= 0) health -= wakeHours;
  if (!isSick && mess < 3 && !critical) health += sleepHours + wakeHours * 0.5;
  health = clamp(health, 0, 100);
  let deadAt = current.deadAt, deathReason = current.deathReason;
  if (health <= 0 && classicLifecycle) { deadAt = now; deathReason = isSick ? "sickness" : "neglect"; }
  else if (health <= 0) health = 10;
  const next = cleanBuddyState({ ...current, hunger, energy, happiness, affection, health, mess, messProgressMs, isSick, deadAt, deathReason, lastSeenAt: now }, now);
  next.stage = resolveBuddyStage(next, now);
  return cleanBuddyState(next, now);
}

function recordAction(state, action, now, relationship = {}) {
  const next = cleanBuddyState(state, now), brain = structuredClone(next.brain);
  brain.actionCounts[action] = integer(brain.actionCounts[action]) + 1;
  brain.lastActions = [...brain.lastActions, action].slice(-16);
  brain.workingMemory = [...brain.workingMemory, { action, at: now }].slice(-32);
  for (const [key, delta] of Object.entries(relationship)) if (key in brain.relationship) brain.relationship[key] = clamp01(brain.relationship[key] + delta);
  return cleanBuddyState({ ...next, affection: brain.relationship.affection * 100, brain, lastActionAt: now, lastSeenAt: now }, now);
}

export function createBrainSnapshot(state, now = Date.now()) {
  const clean = cleanBuddyState(state, now);
  return {
    version: clean.version, buddyId: clean.brain.buddyId, displayName: clean.brain.displayName, mood: getBuddyMood(clean, now), dominantNeed: dominantNeed(clean),
    stage: clean.stage, level: clean.level, xp: clean.xp, bornAt: clean.bornAt,
    lifecycle: { hunger: clean.hunger, energy: clean.energy, happiness: clean.happiness, affection: clean.affection, health: clean.health, mess: clean.mess, isSick: clean.isSick, sleptUntil: clean.sleptUntil },
    brain: structuredClone(clean.brain), careCounts: { ...clean.careCounts }, updatedAt: clean.lastSeenAt || now,
  };
}

function performCare(state, action, now) {
  let current = cleanBuddyState(state, now);
  if (current.deadAt > 0 && action !== "start-over") return { state: current, reaction: "error", message: "I need a fresh start before we can do that." };
  if (action !== "nap") current.sleptUntil = 0;
  let relationship = {}, reaction = "idle", message = "Okay!";
  let xpAmount = 0;
  switch (action) {
    case "feed":
      if (current.isSick) return { state: current, reaction: "error", message: "I don’t feel well enough to eat much. Medicine first?" };
      current.hunger = Math.min(100, current.hunger + 25); current.health = Math.min(100, current.health + 2); current.careCounts.fed += 1;
      relationship = { trust: 0.01, familiarity: 0.005 }; reaction = "celebrating"; message = "Snack acquired. Excellent human work."; xpAmount = 5; break;
    case "play":
      if (current.isSick) return { state: current, reaction: "error", message: "I’m feeling gross. Can we fix that before zoomies?" };
      current.happiness = Math.min(100, current.happiness + 25); current.energy = Math.max(0, current.energy - 15); current.health = Math.min(100, current.health + 1); current.careCounts.played += 1;
      relationship = { familiarity: 0.015, affection: 0.01 }; reaction = "celebrating"; message = "Okay that ruled. Again later."; xpAmount = 5; break;
    case "pet":
      current.affection = Math.min(100, current.affection + 15); current.happiness = Math.min(100, current.happiness + 10); current.health = Math.min(100, current.health + 1); current.careCounts.petted += 1;
      relationship = { trust: 0.01, familiarity: 0.01 }; reaction = "waving"; message = "Hehe. Yep, that’s the spot."; xpAmount = 3; break;
    case "nap":
      current.energy = Math.min(100, current.energy + 40); current.health = Math.min(100, current.health + 3); current.sleptUntil = now + 15 * MINUTE_MS; current.careCounts.napped += 1;
      relationship = { trust: 0.005 }; reaction = "waiting"; message = "Tiny nap. Important business."; xpAmount = 5; break;
    case "clean":
      if (current.mess <= 0) return { state: current, reaction: "idle", message: "Already squeaky clean." };
      current.mess = 0; current.messProgressMs = 0; current.health = Math.min(100, current.health + 10); current.affection = Math.min(100, current.affection + 5); current.careCounts.cleaned += 1;
      relationship = { trust: 0.01, respect: 0.005 }; reaction = "celebrating"; message = "Fresh! I feel approximately 90% more majestic."; xpAmount = 4; break;
    case "medicine": {
      if (!current.isSick) return { state: current, reaction: "idle", message: "I don’t need medicine right now." };
      const nextDose = current.medicineDoses + 1, cured = nextDose >= 2;
      current.isSick = !cured; current.medicineDoses = cured ? 0 : nextDose; current.health = Math.min(100, current.health + (cured ? 25 : 5)); current.careCounts.medicated += 1;
      relationship = { trust: 0.02, respect: 0.01 }; reaction = cured ? "celebrating" : "waiting"; message = cured ? "Much better. Thank you." : "Bleh. One dose down."; xpAmount = cured ? 6 : 2; break;
    }
    case "start-over":
      if (current.deadAt <= 0) return { state: current, reaction: "idle", message: "I’m still right here! No reset needed." };
      current = cleanBuddyState({ bornAt: now, lastSeenAt: now, careCounts: { restarted: current.careCounts.restarted + 1 }, brain: current.brain }, now);
      reaction = "celebrating"; message = "New chapter. Same Buddy."; break;
    default: return { state: current, reaction: "idle", message: "I’m not sure what that action means yet." };
  }
  const xp = addXp(current, xpAmount); current.xp = xp.xp; current.level = xp.level;
  current = recordAction(current, action, now, relationship); current.stage = resolveBuddyStage(current, now);
  return { state: cleanBuddyState(current, now), reaction, message: xp.leveledUp ? `Level ${current.level}! ${message}` : message };
}

function replyFor(state, message) {
  const mood = getBuddyMood(state), lower = message.toLowerCase(), name = state.brain.displayName || "Buddy";
  if (/\b(hello|hey|hi|yo)\b/.test(lower)) return `Hey! ${name} reporting for tiny-duty.`;
  if (/how are you|how're you|status|feel/.test(lower)) {
    const need = dominantNeed(state);
    return mood === "happy" ? "Pretty great, actually." : `I’m ${mood}. My biggest need right now is ${need}.`;
  }
  if (/hungry|food|snack|eat/.test(lower)) return state.hunger < 50 ? "Food sounds extremely correct right now." : "I’m okay on food, but I will never disrespect a snack.";
  if (/home|house/.test(lower)) return "Home is our little place. We can play together, or you can put it in Idle and let us do our own thing.";
  if (/love|cute|good buddy|good boy|good girl/.test(lower)) return "Okay wow. Logging that directly into the friendship database.";
  if (/remember|memory/.test(lower)) return state.brain.notes.length ? `I’ve got ${state.brain.notes.length} saved note${state.brain.notes.length === 1 ? "" : "s"} and I remember our recent actions.` : "I remember our care, relationship, and recent actions. You can also save notes for me.";
  const playful = state.brain.personality.playfulness >= 0.6;
  return playful ? ["I’m listening.", "Interesting. Continue, human.", "I have placed this thought in my extremely serious tiny brain.", "Okay. Counterpoint: snack?"][state.brain.actionCounts.talk % 4] : "I’m here. Tell me more.";
}

export function createBuddyBrain(storage, { onChange = () => {}, onReaction = () => {} } = {}) {
  let state = cleanBuddyState({}, Date.now());
  let saveTimer = null;
  async function persistSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void storage.setJson(STATE_KEY, state); saveTimer = null; }, 120);
  }
  async function commit(next, reaction = null) {
    state = cleanBuddyState(next, Date.now());
    await persistSoon(); onChange(createBrainSnapshot(state)); if (reaction) onReaction(reaction); return createBrainSnapshot(state);
  }
  return {
    async load() {
      const saved = await storage.getJson(STATE_KEY, null);
      state = cleanBuddyState(saved ?? {}, Date.now());
      const elapsed = Math.max(0, Date.now() - state.lastSeenAt);
      state = applyBuddyDecay(state, elapsed, Date.now(), false);
      await storage.setJson(STATE_KEY, state); onChange(createBrainSnapshot(state)); return createBrainSnapshot(state);
    },
    snapshot() { return createBrainSnapshot(state); },
    async tick(now = Date.now()) {
      const elapsed = Math.max(0, now - state.lastSeenAt);
      if (elapsed < MINUTE_MS) return createBrainSnapshot(state, now);
      return commit(applyBuddyDecay(state, elapsed, now, false));
    },
    async care(action, now = Date.now()) {
      const result = performCare(state, action, now);
      await commit(result.state, result.reaction);
      return { ...result, snapshot: createBrainSnapshot(state, now) };
    },
    async rename(name, now = Date.now()) {
      const clean = cleanBuddyState(state, now), brain = structuredClone(clean.brain);
      brain.displayName = text(name, brain.displayName, 64);
      return commit(recordAction({ ...clean, brain }, "profile-update", now));
    },
    async addNote(note, now = Date.now()) {
      const clean = cleanBuddyState(state, now), value = text(note, "", 500); if (!value) return createBrainSnapshot(clean);
      const brain = structuredClone(clean.brain); brain.notes = [...brain.notes, value].slice(-100);
      return commit(recordAction({ ...clean, brain }, "note-add", now));
    },
    async talk(message, now = Date.now()) {
      const input = text(message, "", 500); if (!input) return { reply: "", snapshot: createBrainSnapshot(state, now) };
      let clean = cleanBuddyState(state, now), brain = structuredClone(clean.brain);
      brain.messages = [...brain.messages, { role: "user", text: input, at: now }].slice(-80);
      clean = recordAction({ ...clean, brain }, "talk", now, { familiarity: 0.002 });
      const reply = replyFor(clean, input); brain = structuredClone(clean.brain);
      brain.messages = [...brain.messages, { role: "buddy", text: reply, at: now }].slice(-80);
      await commit({ ...clean, brain }, "thinking");
      return { reply, snapshot: createBrainSnapshot(state, now) };
    },
  };
}
