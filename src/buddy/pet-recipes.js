export const CANONICAL_DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export const PRISMTEK_PACK_RECIPES = Object.freeze([
  {
    id: "pixellab-balinese-cat", displayName: "Balinese Cat", kind: "buddy", archiveName: "Balinese_Cat-2.zip",
    sha256: "87a63f2f1a540ef06c0f6684cbf7026e869211857091d07b6219dac17ad0f657", width: 60, height: 60,
    includeStates: ["Idle", "laying_down_on_stoma", "sitting_down", "Napping"],
    semanticDefaults: { idle: "Idle", running: "Running", waiting: "[state] sitting_down", failed: "The_cat_lowers_its_head_toward_the_floor_tucking_i" },
  },
  {
    id: "pixellab-shiba-inu", displayName: "Shiba Inu", kind: "buddy", archiveName: "Shiba_Inu-2.zip",
    sha256: "e76cc58d2a5b776c0f8ba1ebd4d9b7dd3c31833a994e75603deccfa1393eecf7", width: 56, height: 56,
    includeStates: ["Idle", "sitting_down", "Sleeping"],
    semanticDefaults: { idle: "Idle", running: "Running", waiting: "[state] sitting_down", failed: "The_dog_lowers_its_head_toward_the_ground_moving_i" },
  },
  {
    id: "pixellab-green-trex", displayName: "Chunky Green T-Rex", kind: "buddy", archiveName: "A_stout_vibrant_green_T-Rex_with_a_rounded_chunky-2.zip",
    sha256: "a50f9f0a4beab34f035c332de7b8bd1055eef543d20d676c8c6b0da06d7458c8", width: 116, height: 116,
    includeStates: ["Adult", "Baby", "Adolescent"],
    semanticDefaults: { idle: "Idle", running: "Walking", failed: "The_dinosaur_winces_and_closes_its_eyes_its_head_s" },
  },
  {
    id: "pixellab-ani-isometric-human", displayName: "Ani Isometric Human", kind: "human", archiveName: "Ani_Iso_Human.zip",
    sha256: "411deb03312a4bbc2dd39ccad069fa143e38184e409819d8a0a23001baef5723", width: 100, height: 100,
    includeStates: ["Idle"],
    semanticDefaults: {
      idle: "The_boy_stands_in_a_relaxed_upright_position_and_g", running: "ani_run", waiting: "The_boy_stands_in_a_relaxed_upright_position_and_g", jumping: "ani_jump", failed: "ani_fall",
    },
  },
]);

export const OPENPETS_BUILTIN_CARD = Object.freeze({
  id: "openpets-builtin", displayName: "Professor Hoot", description: "The built-in OpenPets companion. Import any OpenPets pet package to add it here.", source: "openpets",
});

export const OPENPETS_CATALOG_URL = "https://openpets.dev/pets/catalog.v3.json";
export const OPENPETS_GALLERY_URL = "https://openpets.dev/pets";

export function recipeByHash(hash) { return PRISMTEK_PACK_RECIPES.find((recipe) => recipe.sha256 === hash) ?? null; }
export function recipeByArchiveName(name) { return PRISMTEK_PACK_RECIPES.find((recipe) => recipe.archiveName === name) ?? null; }

export function humanizeAnimationName(name) {
  return String(name).replace(/^\[state\]\s*/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeAnimationId(name) {
  const normalized = String(name).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return normalized || "animation";
}

export function inferSemanticTags(name, state = "") {
  const value = `${name} ${state}`.toLowerCase(), tags = [];
  for (const tag of ["idle", "run", "running", "walk", "jump", "roll", "punch", "death", "fall", "bark", "sleep", "nap", "sit", "wince", "lunge", "wave", "review", "wait", "eat", "eating", "food"]) {
    if (value.includes(tag)) tags.push(tag === "eat" || tag === "food" ? "eating" : tag);
  }
  return [...new Set(tags)];
}

export function inferDurationMs(name) {
  const value = String(name).toLowerCase();
  if (value.includes("run") || value.includes("sprint")) return 680;
  if (value.includes("walk")) return 880;
  if (/jump|roll|punch/.test(value)) return 700;
  if (/death|fall|wince/.test(value)) return 1050;
  if (/eat|eating|food/.test(value)) return 1100;
  return 1000;
}

export function inferSemanticDefaults(animations) {
  const complete = animations.filter((animation) => animation.complete !== false);
  const find = (...tests) => complete.find((animation) => tests.some((test) => test.test(`${animation.id} ${animation.originalName} ${(animation.semanticTags ?? []).join(" ")}`.toLowerCase())))?.id;
  const idle = find(/^idle\b/, /\bidle\b/) ?? complete[0]?.id;
  return {
    idle,
    running: find(/\bani-run\b/, /\brunning\b/, /\bwalking\b/) ?? idle,
    review: find(/review|think|head|curious|wince/) ?? idle,
    waiting: find(/wait|sitting|sleep|nap|relaxed/) ?? idle,
    waving: find(/wave/) ?? idle,
    jumping: find(/jump/) ?? idle,
    failed: find(/failed|wince|fall|slump|head/) ?? idle,
    eating: find(/eat|eating|food/) ?? undefined,
  };
}
