// Builds translations/names/character_classes.json from the game's own ascendancy table.
//
//   node scripts/build_character_classes.mjs
//
// The English and Korean balance dumps share the ascendancy `Id`, so the rows are paired by
// `Id` and the Korean `Name` becomes the translation:
//
//   data/balance/ascendancy.json         { "Id": "Ranger1", "Name": "Deadeye", ... }
//   data/balance/korean/ascendancy.json  { "Id": "Ranger1", "Name": "데드아이", ... }
//
// Rows the game marks `[DNT-UNUSED]` (with their `WIP` Korean placeholders) are skipped. The
// playable classes come from `characters.json`, so every row keeps its dump table name as
// `table` (two tables in one file).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const outputFile = path.join(projectRoot, "translations", "names", "character_classes.json");

const UNUSED_MARKER = /\[(DNT-)?UNUSED\]/i;
const PLACEHOLDER_NAME = /^(wip|incomplete|dnt|reserved)$/i;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const text = (value) => (typeof value === "string" ? value.trim() : "");

// characters = playable classes, ascendancy = their ascendancies. Both dumps share `Id`.
const TABLES = [
  { table: "characters", fileName: "characters.json" },
  { table: "ascendancy", fileName: "ascendancy.json" },
];

const rows = [];
const seen = new Set();
const counts = [];
let skipped = 0;
let missingName = 0;
let duplicates = 0;
for (const { table, fileName } of TABLES) {
  const englishRows = readJson(path.join(balanceDirectory, fileName));
  const koreanRows = readJson(path.join(balanceDirectory, "korean", fileName));
  const koreanById = new Map(koreanRows.map((row) => [row.Id, row]));
  let written = 0;
  for (const english of englishRows) {
    const englishName = text(english.Name);
    const koreanName = text(koreanById.get(english.Id)?.Name);
    if (!englishName || !koreanName) {
      missingName += 1;
      continue;
    }
    if (
      UNUSED_MARKER.test(englishName) ||
      UNUSED_MARKER.test(koreanName) ||
      PLACEHOLDER_NAME.test(englishName) ||
      PLACEHOLDER_NAME.test(koreanName)
    ) {
      skipped += 1;
      continue;
    }
    const key = `${table}/${englishName}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    // 게임 표 순서를 그대로 유지한다(수집 단계는 정렬하지 않는다).
    rows.push({ id: englishName, ko: koreanName, table });
    written += 1;
  }
  counts.push(
    `  ${table}: ${written}행 (english ${englishRows.length}, korean ${koreanRows.length}, ` +
      `${englishRows.length === koreanRows.length ? "개수 일치" : "개수 불일치"})`,
  );
}

writeFileSync(outputFile, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`Wrote ${rows.length} character classes to ${outputFile}`);
for (const line of counts) console.log(line);
console.log(
  `  skipped [UNUSED]/[DNT-UNUSED]/WIP ${skipped}, 이름 없음 ${missingName}, 이름 중복 ${duplicates}`,
);
