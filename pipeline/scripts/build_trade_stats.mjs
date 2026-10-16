// Builds translations/trade_stats.json from the official PoE 2 trade APIs.
//
//   English: https://www.pathofexile.com/api/trade2/data/stats
//   Korean : https://kr.pathofexile.com/api/trade2/data/stats
//
// Both sites publish the same stat ids (`explicit.stat_...`, `pseudo....`), so the
// texts are paired by id. The `#` markers of the trade syntax are kept as-is; the
// extension turns them into numeric placeholders when it renders a translation.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const outputFile = path.join(projectRoot, "translations", "lines/item_mod_lines.json");
const SOURCES = [
  { language: "en", url: "https://www.pathofexile.com/api/trade2/data/stats" },
  { language: "ko", url: "https://kr.pathofexile.com/api/trade2/data/stats" },
];
const REQUEST_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "application/json",
};
const placeholderCount = (text) => (text.match(/#/g) ?? []).length;

async function fetchStats({ language, url }) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }
  const data = await response.json();
  const entries = new Map();
  for (const group of data.result ?? []) {
    for (const entry of group.entries ?? []) {
      const text = typeof entry?.text === "string" ? entry.text.trim() : "";
      if (typeof entry?.id === "string" && text) {
        entries.set(entry.id, { text, type: entry.type ?? group.id ?? "" });
      }
    }
  }
  console.log(`${language}: ${entries.size} stat entries from ${url}`);
  return entries;
}

const [english, korean] = await Promise.all(SOURCES.map(fetchStats));

const byText = new Map();
const typeCounts = new Map();
let missingKorean = 0;
let placeholderMismatch = 0;
let conflictingKorean = 0;
for (const [statId, en] of english) {
  const ko = korean.get(statId);
  if (!ko) {
    missingKorean += 1;
    continue;
  }
  if (placeholderCount(en.text) !== placeholderCount(ko.text)) {
    placeholderMismatch += 1;
    continue;
  }
  const existing = byText.get(en.text);
  if (existing) {
    if (existing.ko !== ko.text) {
      conflictingKorean += 1;
    }
    continue;
  }
  byText.set(en.text, { id: en.text, ko: ko.text });
  typeCounts.set(en.type, (typeCounts.get(en.type) ?? 0) + 1);
}

const rows = [...byText.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
await writeFile(outputFile, `${JSON.stringify(rows, null, 2)}\n`, "utf8");

const distribution = new Map();
for (const row of rows) {
  const count = placeholderCount(row.id);
  distribution.set(count, (distribution.get(count) ?? 0) + 1);
}
console.log(`\nWrote ${rows.length} rows to ${outputFile}`);
console.log(`  skipped: no Korean text ${missingKorean}, placeholder mismatch ${placeholderMismatch}`);
console.log(`  same English text with a different Korean text: ${conflictingKorean}`);
console.log(
  "  placeholders per row:",
  JSON.stringify([...distribution].sort((a, b) => a[0] - b[0])),
);
console.log(
  "  stat types:",
  JSON.stringify([...typeCounts].sort((a, b) => b[1] - a[1]).slice(0, 10)),
);
