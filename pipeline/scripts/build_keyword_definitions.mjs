// Builds translations/lines/keyword_definitions.json: the body text of the keyword
// tooltips ("Debuffs are negative effects that deal damage or penalise an entity's
// stats, ..."), which is the Definition column of keywordpopups.json.
//
//   node scripts/build_keyword_definitions.mjs
//
// A definition can hold several paragraphs and the tooltip prints them as separate
// lines, so the English and Korean paragraphs are paired one by one (they must have the
// same count) and the whole text is stored as well for a single node rendering.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputFile = path.join(projectRoot, "translations", "lines", "keyword_definitions.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// `[Term|Display]` / `[Term]` keyword markup is left as it is (the final data clean up in
// scripts/clean_translations.mjs keeps the last `|` segment). `<white>` colour tags and
// `{...}` markers are dropped here.
const stripMarkup = (text) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/[{}]/g, "")
    .trim();

const flatten = (text) =>
  typeof text === "string"
    ? stripMarkup(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
    : "";

const paragraphs = (text) =>
  typeof text === "string"
    ? stripMarkup(text)
        .replace(/\r\n?/g, "\n")
        .split(/\n\s*\n/)
        .map((part) => part.split("\n").map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : [];

const english = readJson(path.join(balanceDirectory, "keywordpopups.json"));
const koreanById = new Map(readJson(path.join(koreanDirectory, "keywordpopups.json")).map((row) => [row.Id, row]));

const rows = new Map();
const stats = { paragraphPairs: 0, fullTexts: 0, paragraphMismatch: 0, identical: 0, empty: 0, workInProgress: 0, conflict: 0 };

function add(id, ko) {
  if (!id || !ko) {
    stats.empty += 1;
    return;
  }
  if (id === ko) {
    stats.identical += 1;
    return;
  }
  if (/^(wip|\[dnt|dnt)/i.test(ko)) {
    stats.workInProgress += 1;
    return;
  }
  const existing = rows.get(id);
  if (existing) {
    if (existing.ko !== ko) stats.conflict += 1;
    return;
  }
  if (!/\[(DNT-)?UNUSED\]/i.test(id) && !/\[(DNT-)?UNUSED\]/i.test(ko)) {
    rows.set(id, { id, ko });
  }
}

for (const row of english) {
  const koreanRow = koreanById.get(row.Id);
  if (!koreanRow) continue;
  const englishParagraphs = paragraphs(row.Definition);
  const koreanParagraphs = paragraphs(koreanRow.Definition);
  if (englishParagraphs.length === 0 || koreanParagraphs.length === 0) continue;
  if (englishParagraphs.length === koreanParagraphs.length) {
    for (let index = 0; index < englishParagraphs.length; index += 1) {
      add(englishParagraphs[index], koreanParagraphs[index]);
      stats.paragraphPairs += 1;
    }
  } else {
    stats.paragraphMismatch += 1;
  }
  add(flatten(row.Definition), flatten(koreanRow.Definition));
  stats.fullTexts += 1;
}

const sorted = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${sorted.length} rows to ${outputFile}`);
console.log(
  `  문단 쌍 ${stats.paragraphPairs}, 전체 문장 ${stats.fullTexts}, 문단 수 불일치 ${stats.paragraphMismatch}, ` +
    `영한 동일 ${stats.identical}, 빈 값 ${stats.empty}, WIP ${stats.workInProgress}, 충돌 ${stats.conflict}`,
);
const byId = new Map(sorted.map((row) => [row.id, row.ko]));
for (const sample of [
  "Debuffs are negative effects that deal damage or penalise an entity's stats, either for a set duration or when a condition is met.",
  "Unless otherwise stated, Debuffs of the same type do not stack — only the copy with the strongest effect applies.",
]) {
  console.log(`  ${byId.has(sample) ? "O" : "X"} ${sample.slice(0, 70)}… → ${byId.get(sample) ?? ""}`);
}
