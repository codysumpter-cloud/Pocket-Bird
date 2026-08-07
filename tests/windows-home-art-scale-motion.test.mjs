import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const home = read("src/buddy/home.js");
const runtime = read("src/buddy/pet-runtime.js");
const desktopPerches = read("desktop/desktop-perches.js");
const desktopIndex = read("desktop/index.html");

test("Home is TinyHouse-backed and fails closed instead of drawing substitute geometry", () => {
  assert.match(home, /openZipArchive/);
  assert.match(home, /Floor_64_WoodLight\.png/);
  assert.match(home, /Wall_L_64_White\.png/);
  assert.match(home, /Wall_R_64_White\.png/);
  assert.match(home, /Bedroom\/Bed_A_4\.png/);
  assert.match(home, /Living Roon\/Table_10\.png/);
  assert.match(home, /Chairs\/Chair_2_A_Tile\.png/);
  assert.match(home, /Sofa\/Sofa_3_A_Tile\.png/);
  assert.match(home, /Plants\/Plant_1\.png/);
  assert.match(home, /Doors\/Door_2_Brown\.png/);
  assert.match(home, /No substitute human will be drawn/);
  assert.doesNotMatch(home, /fallbackHuman/);
  assert.doesNotMatch(home, /function diamond\(/);
  assert.doesNotMatch(home, /function furniture\(/);
});

test("Home and custom pets honor the original Pocket Bird scale settings", () => {
  assert.match(runtime, /--birb-scale/);
  assert.match(runtime, /--birb-ui-scale/);
  assert.match(runtime, /scaleMultiplier\(\)/);
  assert.match(home, /petRuntime\.scaleMultiplier\(\)/);
  assert.match(home, /petRuntime\.uiScaleMultiplier\(\)/);
  assert.match(home, /--pb-ui-scale/);
});

test("selecting an original Field Guide bird relinquishes the custom-pet overlay", () => {
  assert.match(runtime, /library\.setActive\("pocket-bird"\)/);
  assert.match(runtime, /select\("pocket-bird"\)/);
  assert.match(runtime, /base\.style\.opacity = ""/);
  assert.match(runtime, /overlay\.style\.display = "none"/);
});

test("custom pets reuse Pocket Bird affection feedback", () => {
  assert.match(runtime, /pb-pet-heart/);
  assert.match(runtime, /reaction === "heart"/);
  assert.match(runtime, /reaction === "pet"/);
  assert.match(runtime, /reaction === "waving"/);
  assert.match(home, /petRuntime\.react\("heart"/);
});

test("desktop seeds broad invisible perch targets before Pocket Buddy boots", () => {
  assert.match(desktopPerches, /PERCH_COUNT = 9/);
  assert.match(desktopPerches, /width:\$\{PERCH_WIDTH\}px/);
  assert.match(desktopPerches, /filter:opacity\(0\)/);
  assert.match(desktopPerches, /position:fixed/);
  const perchIndex = desktopIndex.indexOf("desktop-perches.js");
  const buddyIndex = desktopIndex.indexOf("birb.embed.js");
  assert.ok(perchIndex >= 0 && buddyIndex > perchIndex, "desktop perches must exist before the Pocket Bird movement engine starts");
});

test("TinyHouse is intercepted as environment art instead of a pet import", () => {
  assert.match(desktopPerches, /TINYHOUSE_NAME/);
  assert.match(desktopPerches, /kind: "environment"/);
  assert.match(desktopPerches, /source: "private-home-art"/);
  assert.match(desktopPerches, /archiveSha256: hash/);
});
