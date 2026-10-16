// Builds translations/lines/flavour_text.json: the item/unique description lines
// ("Only a madman would ignore a god's instructions.") of the game's FlavourText table.
//
//   node scripts/build_flavour_text.mjs
//
// Both dumps carry the same row ids (`Id`, `HASH16`, `Text`), so the English and the
// Korean text are paired by id. The content script normalises whitespace before it
// looks a line up, so the line breaks of the source become single spaces here.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputFile = path.join(projectRoot, "translations", "lines", "flavour_text.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const english = readJson(path.join(balanceDirectory, "flavourtext.json"));
const koreanById = new Map(
  readJson(path.join(koreanDirectory, "flavourtext.json")).map((row) => [row.Id, row.Text]),
);

const flatten = (text) =>
  typeof text === "string"
    ? text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

const rows = new Map();
const stats = { identical: 0, empty: 0, workInProgress: 0, conflict: 0, missingKorean: 0 };

for (const row of english) {
  const id = flatten(row.Text);
  const ko = flatten(koreanById.get(row.Id));
  if (!id || !ko) {
    if (!ko) stats.missingKorean += 1;
    stats.empty += 1;
    continue;
  }
  if (id === ko) {
    stats.identical += 1;
    continue;
  }
  if (/^(wip|\[dnt|dnt)/i.test(ko)) {
    stats.workInProgress += 1;
    continue;
  }
  const existing = rows.get(id);
  if (existing) {
    if (existing.ko !== ko) stats.conflict += 1;
    continue;
  }
  if (!/\[(DNT-)?UNUSED\]/i.test(id) && !/\[(DNT-)?UNUSED\]/i.test(ko)) {
    rows.set(id, { id, ko });
  }
}

const sorted = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${sorted.length} rows to ${outputFile}`);
console.log(
  `  skipped: 영한 동일 ${stats.identical}, 빈 값 ${stats.empty}, WIP ${stats.workInProgress}, ` +
    `한글 없음 ${stats.missingKorean}, 같은 영문 다른 번역 ${stats.conflict}`,
);
const byId = new Map(sorted.map((row) => [row.id, row.ko]));
for (const sample of [
  "Only a madman would ignore a god's instructions.",
  "As battle calms, blood turns to rust.",
  "Fear is highly infectious.",
]) {
  console.log(`  ${byId.has(sample) ? "O" : "X"} ${sample} → ${byId.get(sample) ?? ""}`);
}
console.log("  샘플:", JSON.stringify(sorted.slice(0, 3).map((row) => `${row.id} → ${row.ko}`), null, 0));
