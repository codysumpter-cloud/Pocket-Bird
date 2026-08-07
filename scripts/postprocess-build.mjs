import { readFileSync, writeFileSync, existsSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = String(packageJson.version || "0.0.0");
const sourceUrl = "https://github.com/codysumpter-cloud/Pocket-Buddy";

const javascriptOutputs = [
  "dist/web/birb.js",
  "dist/web/birb.embed.js",
  "dist/userscript/birb.user.js",
  "dist/extension/birb.js",
  "dist/obsidian/main.js",
];

for (const path of javascriptOutputs) {
  if (!existsSync(path)) continue;
  let content = readFileSync(path, "utf8");
  content = content
    .replaceAll("https://github.com/IdreesInc/Pocket-Bird", sourceUrl)
    .replace(/Build \d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?/g, `Pocket Buddy ${version}`)
    .replace(/Thank you for using Pocket Bird! You are on version: \d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?/g, `Thank you for using Pocket Buddy! You are on version: ${version}`);
  writeFileSync(path, content);
}

const userscriptPath = "dist/userscript/birb.user.js";
if (existsSync(userscriptPath)) {
  let content = readFileSync(userscriptPath, "utf8");
  content = content.replace(/^\/\/ @version\s+.*$/m, `// @version      ${version}`);
  writeFileSync(userscriptPath, content);
}

for (const manifestPath of ["dist/extension/manifest.json", "dist/obsidian/manifest.json"]) {
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
}

console.log(`Pocket Buddy build identity normalized to ${version}.`);
