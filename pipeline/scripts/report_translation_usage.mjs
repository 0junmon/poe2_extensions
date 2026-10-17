import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

// Local-only analysis: compares the translation database with the strings that
// the crawled poe.ninja pages actually render (data/poe_ninja_audit/page-*.json).
// Reports used / unused entries, duplicate keys and still-untranslated strings.
//
// Usage: node scripts/report_translation_usage.mjs

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const auditDirectory = path.join(projectRoot, "data", "poe_ninja_audit");

const DATA_FILES = [
  "names/game_terms.json",
  "names/mods.json",
  "names/keywordpopups.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/base_item_variants.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
  "general/poe_ninja.json",
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

const entriesByFile = new Map();
const byKey = new Map();

for (const fileName of DATA_FILES) {
  const payload = JSON.parse(
    await readFile(path.join(translationDirectory, fileName), "utf8"),
  );
  const entries = [];
  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        entries.push({ fileName, id: row.id, ko: row.ko });
      }
    }
  } else if (payload && typeof payload === "object") {
    for (const [id, ko] of Object.entries(payload)) {
      if (typeof ko === "string") {
        entries.push({ fileName, id, ko });
      }
    }
  }
  entriesByFile.set(fileName, entries);

  for (const entry of entries) {
    const key = normalizeEnglish(entry.id);
    if (!key) {
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }
}

const duplicates = [];
for (const [key, list] of byKey) {
  if (list.length < 2) {
    continue;
  }
  const koValues = [...new Set(list.map((entry) => entry.ko))];
  duplicates.push({
    key,
    occurrences: list.length,
    conflict: koValues.length > 1,
    koValues,
    entries: list.map((entry) => `${entry.fileName}:${entry.id}`),
  });
}

await mkdir(auditDirectory, { recursive: true });

const pageFiles = (await readdir(auditDirectory)).filter(
  (fileName) => fileName.startsWith("page-") && fileName.endsWith(".json"),
);
const pages = [];
for (const fileName of pageFiles) {
  const report = JSON.parse(
    await readFile(path.join(auditDirectory, fileName), "utf8"),
  );
  if (report && Array.isArray(report.matched) && Array.isArray(report.unmatched)) {
    pages.push(report);
  }
}

const valuePages = new Map();
for (const page of pages) {
  for (const value of [...page.matched, ...page.unmatched]) {
    const pageSet = valuePages.get(value) ?? new Set();
    pageSet.add(page.url);
    valuePages.set(value, pageSet);
  }
}

const usedEntries = new Map();
const unmatchedValues = [];
for (const [value, pageSet] of valuePages) {
  const list = byKey.get(normalizeEnglish(value));
  if (!list) {
    unmatchedValues.push({
      value,
      pageCount: pageSet.size,
      pages: [...pageSet],
    });
    continue;
  }
  for (const entry of list) {
    const entryKey = `${entry.fileName}\u0000${entry.id}`;
    const record = usedEntries.get(entryKey) ?? { ...entry, pages: new Set() };
    for (const pageUrl of pageSet) {
      record.pages.add(pageUrl);
    }
    usedEntries.set(entryKey, record);
  }
}

const fileStats = [];
const unusedEntries = [];
for (const [fileName, entries] of entriesByFile) {
  const used = entries.filter((entry) =>
    usedEntries.has(`${fileName}\u0000${entry.id}`),
  );
  const unused = entries.filter(
    (entry) => !usedEntries.has(`${fileName}\u0000${entry.id}`),
  );
  for (const entry of unused) {
    unusedEntries.push(entry);
  }
  fileStats.push({
    fileName,
    entries: entries.length,
    used: used.length,
    unused: unused.length,
    usedPercent: entries.length
      ? Math.round((used.length / entries.length) * 1000) / 10
      : 0,
  });
}

unmatchedValues.sort(
  (a, b) => b.pageCount - a.pageCount || a.value.localeCompare(b.value),
);
const frequentUnmatched = unmatchedValues.filter((item) => item.pageCount > 1);
const conflictingDuplicates = duplicates.filter((item) => item.conflict);
const redundantDuplicates = duplicates.filter((item) => !item.conflict);

const usedEntriesSerializable = [...usedEntries.values()].map((entry) => ({
  fileName: entry.fileName,
  id: entry.id,
  ko: entry.ko,
  pageCount: entry.pages.size,
  pages: [...entry.pages],
}));

await writeFile(
  path.join(auditDirectory, "used-entries.json"),
  JSON.stringify(usedEntriesSerializable, null, 2),
  "utf8",
);
await writeFile(
  path.join(auditDirectory, "unused-entries.json"),
  JSON.stringify(unusedEntries, null, 2),
  "utf8",
);
await writeFile(
  path.join(auditDirectory, "unmatched-strings.json"),
  JSON.stringify(unmatchedValues, null, 2),
  "utf8",
);

const lines = [];
lines.push("poe.ninja 한글 DB 사용현황 리포트");
lines.push(`분석 페이지 수: ${pages.length}`);
lines.push(`DB 전체 항목: ${[...entriesByFile.values()].reduce((sum, list) => sum + list.length, 0)}`);
lines.push(`DB 고유 키  : ${byKey.size}`);
lines.push(`페이지에서 확인된 고유 문자열: ${valuePages.size}`);
lines.push(`사용된 DB 항목: ${usedEntriesSerializable.length}`);
lines.push(`미사용 DB 항목: ${unusedEntries.length}`);
lines.push("");
lines.push("[테이블별 사용/미사용]");
lines.push("파일 | 전체 | 사용 | 미사용 | 사용률");
for (const stat of fileStats) {
  lines.push(
    `${stat.fileName} | ${stat.entries} | ${stat.used} | ${stat.unused} | ${stat.usedPercent}%`,
  );
}
lines.push("");
lines.push(`[중복 키] 총 ${duplicates.length}개 (값 충돌 ${conflictingDuplicates.length}개, 동일값 중복 ${redundantDuplicates.length}개)`);
lines.push("-- 값이 서로 다른(충돌) 중복 키 상위 40개 --");
for (const item of conflictingDuplicates.slice(0, 40)) {
  lines.push(
    `${item.key} => ${item.koValues.join(" | ")}  (${item.entries.join(", ")})`,
  );
}
lines.push("");
lines.push(`[미번역 문자열] 총 ${unmatchedValues.length}개, 2개 이상 페이지에서 등장한 것 ${frequentUnmatched.length}개`);
lines.push("-- 2개 이상 페이지에 등장한 미번역 문자열 --");
for (const item of frequentUnmatched.slice(0, 200)) {
  lines.push(`${item.pageCount}회: ${item.value}`);
}
lines.push("");
lines.push("-- 사용된 항목 상위 60개 --");
for (const entry of [...usedEntriesSerializable].sort((a, b) => b.pageCount - a.pageCount).slice(0, 60)) {
  lines.push(`${entry.pageCount}회: ${entry.id} => ${entry.ko} (${entry.fileName})`);
}
lines.push("");
lines.push("-- 미사용 항목 샘플(파일별 20개) --");
for (const [fileName] of entriesByFile) {
  const sample = unusedEntries.filter((entry) => entry.fileName === fileName).slice(0, 20);
  if (sample.length === 0) {
    continue;
  }
  lines.push(`[${fileName}]`);
  for (const entry of sample) {
    lines.push(`  ${entry.id} => ${entry.ko}`);
  }
}

const reportText = `${lines.join("\r\n")}\r\n`;
await writeFile(path.join(auditDirectory, "usage-report.txt"), reportText, "utf8");

console.log(`pages analysed      : ${pages.length}`);
console.log(`unique page strings : ${valuePages.size}`);
console.log(`db entries          : ${[...entriesByFile.values()].reduce((sum, list) => sum + list.length, 0)}`);
console.log(`used db entries     : ${usedEntriesSerializable.length}`);
console.log(`unused db entries   : ${unusedEntries.length}`);
console.log(`duplicate keys      : ${duplicates.length} (conflicting: ${conflictingDuplicates.length})`);
console.log(`untranslated strings: ${unmatchedValues.length} (multi-page: ${frequentUnmatched.length})`);
console.log("\nper file:");
for (const stat of fileStats) {
  console.log(
    `  ${stat.fileName.padEnd(28)} total=${String(stat.entries).padStart(6)} used=${String(stat.used).padStart(6)} unused=${String(stat.unused).padStart(6)} ${stat.usedPercent}%`,
  );
}
console.log(`\nreport: ${path.join(auditDirectory, "usage-report.txt")}`);

