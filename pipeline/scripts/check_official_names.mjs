import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

// Local-only helper: prints the official English <-> Korean name pairs of a
// balance table so a translation entry can be verified against the game data.
//
// Usage:
//   node scripts/check_official_names.mjs <table> <substring> [field]

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");

const [tableName, substring, fieldFilter] = process.argv.slice(2);
if (!tableName || !substring) {
  console.error(
    "Usage: node scripts/check_official_names.mjs <table> <substring> [field]",
  );
  process.exit(1);
}

const fileName = `${tableName}.json`;
const parse = async (filePath) =>
  JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));

const englishRows = await parse(path.join(balanceDirectory, fileName));
const koreanRows = await parse(path.join(koreanDirectory, fileName));
const koreanById = new Map();
for (const row of koreanRows) {
  if (row && typeof row.Id === "string" && !koreanById.has(row.Id)) {
    koreanById.set(row.Id, row);
  }
}

const needle = substring.toLowerCase();
let printed = 0;
for (const englishRow of englishRows) {
  if (!englishRow || typeof englishRow.Id !== "string") {
    continue;
  }
  const koreanRow = koreanById.get(englishRow.Id) ?? {};
  const rowMatches = englishRow.Id.toLowerCase().includes(needle);
  for (const [field, englishValue] of Object.entries(englishRow)) {
    if (field === "Id" || typeof englishValue !== "string") {
      continue;
    }
    if (fieldFilter && field !== fieldFilter) {
      continue;
    }
    if (!rowMatches && !englishValue.toLowerCase().includes(needle)) {
      continue;
    }
    const koreanValue = koreanRow[field];
    console.log(
      `${englishRow.Id}\n  en.${field} = ${englishValue}\n  ko.${field} = ${typeof koreanValue === "string" ? koreanValue : "<missing>"}`,
    );
    printed += 1;
  }
}

console.log(`matched ${printed} field(s) in ${fileName}`);
