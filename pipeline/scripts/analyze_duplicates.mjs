import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

// Local-only diagnostics: classifies duplicate translation keys (same table vs
// across tables vs across files), shows which value the extension resolves
// today, and looks up the official Korean name from the balance data dumps.
//
// Usage: node scripts/analyze_duplicates.mjs

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputDirectory = path.join(projectRoot, "data", "poe_ninja_audit");

// Mirrors the userscript load order: interface first, then the core files, and
// custom.json last with override rights.
const LOAD_ORDER = [
  "general/poe_ninja.json",
  "names/game_terms.json",
  "names/mods.json",
  "names/keywordpopups.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/base_item_variants.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
  "general/keyword.json",
  "general/custom.json",
];

const normalizeEnglish = (value) =>
  value
    .replace(/_/g, " ")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");

const parseJsonFile = async (filePath) => {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
};

const occurrences = [];
for (const fileName of LOAD_ORDER) {
  const payload = await parseJsonFile(
    path.join(translationDirectory, fileName),
  );
  const fallbackTable = fileName.replace(/\.json$/, "");
  if (Array.isArray(payload)) {
    payload.forEach((row, index) => {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        occurrences.push({
          fileName,
          index,
          id: row.id,
          ko: row.ko,
          table: typeof row.table === "string" ? row.table : fallbackTable,
          baseItem: typeof row.baseItem === "string" ? row.baseItem : null,
          loadOrder: LOAD_ORDER.indexOf(fileName),
        });
      }
    });
  } else if (payload && typeof payload === "object") {
    Object.entries(payload).forEach(([id, ko], index) => {
      if (typeof ko === "string") {
        occurrences.push({
          fileName,
          index,
          id,
          ko,
          table: fallbackTable,
          baseItem: null,
          loadOrder: LOAD_ORDER.indexOf(fileName),
        });
      }
    });
  }
}

const groups = new Map();
for (const occurrence of occurrences) {
  const key = normalizeEnglish(occurrence.id);
  if (!key) {
    continue;
  }
  const list = groups.get(key) ?? [];
  list.push(occurrence);
  groups.set(key, list);
}

const targetKeys = new Set(groups.keys());
const officialIndex = new Map();
const koreanFiles = (await readdir(koreanDirectory)).filter((fileName) =>
  fileName.endsWith(".json"),
);
let pairedTables = 0;

const recordOfficial = (key, koreanValue, tableName) => {
  let perKorean = officialIndex.get(key);
  if (!perKorean) {
    perKorean = new Map();
    officialIndex.set(key, perKorean);
  }
  let entry = perKorean.get(koreanValue);
  if (!entry) {
    entry = { ko: koreanValue, tables: new Set(), count: 0 };
    perKorean.set(koreanValue, entry);
  }
  entry.tables.add(tableName);
  entry.count += 1;
};

for (const fileName of koreanFiles) {
  const englishRows = await parseJsonFile(
    path.join(balanceDirectory, fileName),
  ).catch(() => null);
  const koreanRows = await parseJsonFile(
    path.join(koreanDirectory, fileName),
  ).catch(() => null);
  if (!Array.isArray(englishRows) || !Array.isArray(koreanRows)) {
    continue;
  }

  const grouped = new Map();
  for (const row of koreanRows) {
    if (row && typeof row.Id === "string" && row.Id) {
      const list = grouped.get(row.Id) ?? [];
      list.push(row);
      grouped.set(row.Id, list);
    }
  }
  pairedTables += 1;

  for (const englishRow of englishRows) {
    if (!englishRow || typeof englishRow.Id !== "string") {
      continue;
    }
    const matches = grouped.get(englishRow.Id);
    if (!matches || matches.length !== 1) {
      continue;
    }
    const koreanRow = matches[0];
    for (const [field, englishValue] of Object.entries(englishRow)) {
      if (field === "Id" || typeof englishValue !== "string") {
        continue;
      }
      const koreanValue = koreanRow[field];
      if (
        typeof koreanValue !== "string" ||
        !englishValue.trim() ||
        !koreanValue.trim() ||
        englishValue === koreanValue
      ) {
        continue;
      }
      const key = normalizeEnglish(englishValue);
      if (!key || !targetKeys.has(key)) {
        continue;
      }
      recordOfficial(key, koreanValue.trim(), fileName.replace(/\.json$/, ""));
    }
  }
}

const duplicateGroups = [];
for (const [key, list] of groups) {
  if (list.length < 2) {
    continue;
  }
  const koValues = [...new Set(list.map((occurrence) => occurrence.ko))];
  const fileTablePairs = new Set(
    list.map((occurrence) => `${occurrence.fileName}\u0000${occurrence.table}`),
  );
  const customOccurrences = list.filter(
    (occurrence) => occurrence.fileName === "general/custom.json",
  );
  const keywordOccurrences = list.filter(
    (occurrence) => occurrence.fileName === "general/keyword.json",
  );
  const effective = customOccurrences.length
    ? customOccurrences[0]
    : keywordOccurrences.length
      ? keywordOccurrences[0]
      : [...list].sort((a, b) => a.loadOrder - b.loadOrder)[0];
  duplicateGroups.push({
    key,
    occurrences: list,
    koValues,
    conflict: koValues.length > 1,
    sameFileSameTable: list.length > fileTablePairs.size,
    tables: [...new Set(list.map((occurrence) => occurrence.table))],
    files: [...new Set(list.map((occurrence) => occurrence.fileName))],
    effective,
    official: [...(officialIndex.get(key)?.values() ?? [])].map((entry) => ({
      ko: entry.ko,
      tables: [...entry.tables],
      count: entry.count,
    })),
  });
}

duplicateGroups.sort((a, b) => a.key.localeCompare(b.key));

const stripEnglishSuffix = (value) =>
  value.replace(/\s*\((?=[^)]*[A-Za-z])[^)]*\)/g, "").replace(/\s+/g, " ").trim();

const sameFileSameTableGroups = duplicateGroups.filter(
  (group) => group.sameFileSameTable,
);
const crossFileGroups = duplicateGroups.filter(
  (group) => !group.sameFileSameTable && group.files.length > 1,
);
const crossTableGroups = duplicateGroups.filter(
  (group) =>
    !group.sameFileSameTable && group.files.length === 1 && group.tables.length > 1,
);
const conflictGroups = duplicateGroups.filter((group) => group.conflict);

for (const group of duplicateGroups) {
  const officialKorean = [...new Set(group.official.map((entry) => entry.ko))];
  const officialClean = new Set(officialKorean.map(stripEnglishSuffix));
  group.candidates = group.occurrences.map((occurrence) => ({
    fileName: occurrence.fileName,
    table: occurrence.table,
    ko: occurrence.ko,
    cleanKo: stripEnglishSuffix(occurrence.ko),
    isEffective: occurrence === group.effective,
    officialMatch:
      officialKorean.includes(occurrence.ko) ||
      officialClean.has(stripEnglishSuffix(occurrence.ko)),
  }));
  const officialCandidates = group.candidates.filter(
    (candidate) => candidate.officialMatch,
  );
  const distinctOfficial = new Set(
    officialCandidates.map((candidate) => candidate.ko),
  );
  group.officialKorean = officialKorean;
  group.resolution =
    officialKorean.length === 0
      ? "no-official-data"
      : officialCandidates.length === 0
        ? "official-differs"
        : distinctOfficial.size === 1
          ? "official-single"
          : "official-multiple";
}

const lines = [];
lines.push("poe.ninja 한글 DB 중복 키 진단");
lines.push(`총 항목 수: ${occurrences.length}`);
lines.push(`고유 키 수: ${groups.size}`);
lines.push(`중복 키(2개 이상): ${duplicateGroups.length}`);
lines.push(`  - 같은 파일 · 같은 테이블 중복: ${sameFileSameTableGroups.length}`);
lines.push(`  - 파일만 다른 중복        : ${crossFileGroups.length}`);
lines.push(`  - 테이블만 다른 중복      : ${crossTableGroups.length}`);
lines.push(`값 충돌(서로 다른 번역): ${conflictGroups.length}`);
lines.push(`공식 한글 데이터 매칭 테이블: ${pairedTables}`);
lines.push("");
lines.push("[값 충돌 그룹 상세]");
for (const group of conflictGroups) {
  lines.push(`* ${group.key}  [해결: ${group.resolution}]`);
  lines.push(
    `  현재 적용값: ${group.effective.ko} (${group.effective.fileName}:${group.effective.table})`,
  );
  for (const candidate of group.candidates) {
    lines.push(
      `  후보: ${candidate.ko} (${candidate.fileName}:${candidate.table})` +
        `${candidate.isEffective ? " [현재 적용]" : ""}` +
        `${candidate.officialMatch ? " [공식 일치]" : ""}`,
    );
  }
  lines.push(
    `  공식 한글: ${group.officialKorean.length ? group.officialKorean.join(" / ") : "없음"}`,
  );
}
lines.push("");
lines.push("[같은 파일 · 같은 테이블 내 중복 상위 60개]");
for (const group of sameFileSameTableGroups.slice(0, 60)) {
  const detail = group.occurrences
    .map((occurrence) => `${occurrence.fileName}:${occurrence.table}="${occurrence.ko}"`)
    .join(" | ");
  lines.push(`* ${group.key} => ${detail}`);
}

const reportText = `${lines.join("\r\n")}\r\n`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "duplicates-report.txt"),
  reportText,
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "duplicates-report.json"),
  JSON.stringify(
    {
      totals: {
        occurrences: occurrences.length,
        uniqueKeys: groups.size,
        duplicateGroups: duplicateGroups.length,
        sameFileSameTable: sameFileSameTableGroups.length,
        crossFile: crossFileGroups.length,
        crossTable: crossTableGroups.length,
        conflicts: conflictGroups.length,
      },
      groups: duplicateGroups,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`occurrences         : ${occurrences.length}`);
console.log(`unique keys         : ${groups.size}`);
console.log(`duplicate keys      : ${duplicateGroups.length}`);
console.log(`  same file+table   : ${sameFileSameTableGroups.length}`);
console.log(`  cross file        : ${crossFileGroups.length}`);
console.log(`  cross table       : ${crossTableGroups.length}`);
console.log(`conflicting values  : ${conflictGroups.length}`);
console.log(`paired tables       : ${pairedTables}`);
console.log(`report: ${path.join(outputDirectory, "duplicates-report.txt")}`);


