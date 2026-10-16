// Builds translations/game_names.json: the proper names poe.ninja prints outside of
// item tooltips, currently the world area a character is in and the map pins.
//
//   node scripts/build_game_names.mjs
//
// Both tables store the English and the Korean name under the same row id
// (`worldareas.Name`, `mappins.Name`), so the pairs come from the Korean dump.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputFile = path.join(projectRoot, "translations", "names/area_and_quest_names.json");

// Tables whose Name column is a proper name shown in the interface.
const NAME_TABLES = ["worldareas.json", "mappins.json", "quest.json"];
// A bare short word ("Pit", "Abyss") is used as a keyword elsewhere on the page too,
// so only names that are long enough are stored - except for the proper nouns below,
// which poe.ninja prints on a character page.
const MIN_NAME_LENGTH = 6;
const SHORT_NAME_ALLOWLIST = new Set(["Qimah"]);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const rows = new Map();
const stats = { missing: 0, identical: 0, tooShort: 0, conflict: 0, perTable: {} };

for (const fileName of NAME_TABLES) {
  const tableName = fileName.replace(".json", "");
  const english = readJson(path.join(balanceDirectory, fileName));
  const koreanById = new Map(
    readJson(path.join(koreanDirectory, fileName)).map((row) => [row.Id, row.Name]),
  );
  stats.perTable[tableName] = 0;
  for (const row of english) {
    const englishName = row.Name;
    const koreanName = koreanById.get(row.Id);
    if (
      typeof englishName !== "string" ||
      !englishName.trim() ||
      typeof koreanName !== "string" ||
      !koreanName.trim()
    ) {
      stats.missing += 1;
      continue;
    }
    if (englishName === koreanName) {
      stats.identical += 1;
      continue;
    }
    if (englishName.length < MIN_NAME_LENGTH && !SHORT_NAME_ALLOWLIST.has(englishName)) {
      stats.tooShort += 1;
      continue;
    }
    const existing = rows.get(englishName);
    if (existing) {
      if (existing.ko !== koreanName) {
        stats.conflict += 1;
      }
      continue;
    }
    if (!/\[(DNT-)?UNUSED\]/i.test(englishName) && !/\[(DNT-)?UNUSED\]/i.test(koreanName)) {
      rows.set(englishName, { id: englishName, ko: koreanName });
    }
    stats.perTable[tableName] += 1;
  }
}

const sorted = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${sorted.length} rows to ${outputFile}`);
console.log("  per table:", JSON.stringify(stats.perTable, null, 0));
console.log(
  `  skipped: 한글 없음 ${stats.missing}, 영한 동일 ${stats.identical}, ` +
    `너무 짧음(${MIN_NAME_LENGTH}자 미만) ${stats.tooShort}, 중복 충돌 ${stats.conflict}`,
);
const byId = new Map(sorted.map((row) => [row.id, row.ko]));
for (const sample of [
  "Valley of the Titans",
  "The Venom Crypts",
  "The Seven Pillars",
  "Halls of the Dead",
  "Ngamahu's Test",
  "Qimah",
]) {
  console.log(`  ${byId.has(sample) ? "O" : "X"} ${sample} -> ${byId.get(sample) ?? ""}`);
}
console.log("  샘플:", JSON.stringify(sorted.slice(0, 5).map((row) => `${row.id} -> ${row.ko}`), null, 0));
