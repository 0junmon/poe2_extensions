// Builds translations/stat_descriptions.json from the game's own StatDescription
// files (`.csd`) that a GGPK tool exported to `data/statdescriptions`.
//
//   node scripts/build_csd_lines.mjs
//
// The files are UTF-16 and hold every language in one file, so no separate English
// client is needed. Grammar:
//
//   include "Data/StatDescriptions/skill_stat_descriptions.csd"
//
//   description
//   	1 active_skill_base_area_of_effect_radius    <- stat ids of the block
//   	2                                            <- number of format lines below
//   		10 "Shockwave radius is {0} metre" div...  <- English (no `lang` marker)
//   		# "Shockwave radius is {0} metres" div...
//   	lang "Korean"
//   	2
//   		10 "충격파 반경 {0}미터" div...
//   		# "충격파 반경 {0}미터" div...
//
// The English and Korean format lines of one block are in the same order, so they are
// paired by index. `[Term|Display]` becomes the display text the game shows and every
// `{n}` / `@{n}` placeholder becomes the `#` marker the extension already understands.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const csdDirectory = path.join(projectRoot, "data", "statdescriptions");
const outputFile = path.join(projectRoot, "translations", "lines/stat_lines.json");

const ENGLISH_LANGUAGE = "English";
const KOREAN_LANGUAGE = "Korean";
// A value free line that is shorter than this is not stored: translating a bare word
// everywhere on the page would be too broad.
const MIN_VALUE_FREE_LENGTH = 12;

function decode(file) {
  const buffer = readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const copy = Buffer.from(buffer);
    copy.swap16();
    return copy.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.toLowerCase().endsWith(".csd")) out.push(full);
  }
  return out;
}

const QUOTED_TEMPLATE = /"((?:[^"\\]|\\.)*)"/;

function parseTemplateLine(line) {
  const match = QUOTED_TEMPLATE.exec(line);
  if (!match) {
    return null;
  }
  const template = match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  return { selector: line.slice(0, match.index).trim(), template };
}

// `{0}`/`@{0}` -> `#`. `[Term|Display]` / `[Term]` keyword markup is left as it is: the final
// data clean up (scripts/clean_translations.mjs) keeps the last `|` segment.
function toDisplayTemplate(template) {
  return template
    .replace(/@?\{[^{}]*\}/g, "#")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One `description` block: the stat ids plus the format lines per language.
function parseFile(text) {
  const blocks = [];
  let block = null;
  let language = ENGLISH_LANGUAGE;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (/^description\s*$/.test(line)) {
      block = { ids: "", groups: new Map() };
      blocks.push(block);
      language = ENGLISH_LANGUAGE;
      continue;
    }
    if (/^no_(description|identifiers)\b/.test(line)) {
      block = null;
      continue;
    }
    if (/^\s*include\b/.test(line) || line.trim() === "") {
      continue;
    }
    const languageMatch = /^\s*lang\s+"([^"]+)"/.exec(line);
    if (languageMatch) {
      language = languageMatch[1];
      continue;
    }
    if (/^\t\d+\s*$/.test(line)) {
      continue; // number of format lines that follow
    }
    if (/^\t\S/.test(line)) {
      if (block && block.ids === "") {
        block.ids = line.trim(); // "1 stat_id stat_id_2"
      }
      continue;
    }
    if (/^\t\t/.test(line)) {
      const parsed = parseTemplateLine(line);
      // `table_only` 줄은 게임 내부 표 전용이라 화면에 표시되지 않는다.
      if (parsed && block && !/(^|\s)table_only(\s|$)/.test(parsed.selector)) {
        const list = block.groups.get(language) ?? [];
        list.push(parsed);
        block.groups.set(language, list);
      } else if (parsed) {
        stats.tableOnly += 1;
      }
    }
  }
  return blocks;
}

const rows = new Map();
const stats = {
  files: 0,
  blocks: 0,
  missingKorean: 0,
  lengthMismatch: 0,
  placeholderMismatch: 0,
  identical: 0,
  tooShort: 0,
  valueFree: 0,
  conflict: 0,
  tableOnly: 0,
};

function add(id, ko) {
  const existing = rows.get(id);
  if (existing) {
    if (existing.ko !== ko) {
      stats.conflict += 1;
    }
    return;
  }
  if (!/\[(DNT-)?UNUSED\]/i.test(id) && !/\[(DNT-)?UNUSED\]/i.test(ko)) {
    rows.set(id, { id, ko });
  }
}

for (const file of walk(csdDirectory)) {
  stats.files += 1;
  for (const block of parseFile(decode(file))) {
    stats.blocks += 1;
    const english = block.groups.get(ENGLISH_LANGUAGE) ?? [];
    const korean = block.groups.get(KOREAN_LANGUAGE) ?? [];
    if (english.length === 0) {
      continue;
    }
    if (korean.length === 0) {
      stats.missingKorean += 1;
      continue;
    }
    if (english.length !== korean.length) {
      stats.lengthMismatch += 1;
    }
    const count = Math.min(english.length, korean.length);
    for (let index = 0; index < count; index += 1) {
      const id = toDisplayTemplate(english[index].template);
      const ko = toDisplayTemplate(korean[index].template);
      if (!id || !ko || !/[A-Za-z]/.test(id)) {
        continue;
      }
      if (!id.includes("#") && id.length < MIN_VALUE_FREE_LENGTH) {
        stats.tooShort += 1;
        continue;
      }
      if (!id.includes("#")) {
        stats.valueFree += 1;
      }
      if (id === ko) {
        stats.identical += 1;
        continue;
      }
      if ((id.match(/#/g) ?? []).length !== (ko.match(/#/g) ?? []).length) {
        stats.placeholderMismatch += 1;
        continue;
      }
      add(id, ko);
    }
  }
}

const sorted = [...rows.values()]
  .map(({ id, ko, table }) => ({ id, ko, table }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

const templateRows = sorted.filter((row) => row.id.includes("#"));
console.log(`Wrote ${sorted.length} rows to ${outputFile}`);
console.log(`  parsed files ${stats.files}, description blocks ${stats.blocks}`);
console.log(
  `  skipped: Korean 없음 ${stats.missingKorean}, 줄 수 불일치 ${stats.lengthMismatch}, ` +
    `플레이스홀더 불일치 ${stats.placeholderMismatch}, 영한 동일 ${stats.identical}, ` +
    `짧은 값없음 줄 ${stats.tooShort}, table_only ${stats.tableOnly}`,
);
console.log(`  값 없는(정확 일치) 줄 ${stats.valueFree}, 중복 id 다른 번역 ${stats.conflict}`);
console.log(`  템플릿(# 포함) ${templateRows.length}`);

const samples = [
  "While Dual Wielding, both weapons hit with #% less damage",
  "Shockwave radius is # metres",
  "Cannot cause Stun Buildup",
  "Cannot cause Stun buildup",
  "#% more damage with Hits for Shockwaves originating from a Unique enemy",
  "+# metres to Melee Strike Range",
];
const byId = new Map(sorted.map((row) => [row.id, row.ko]));
console.log("  관심 줄:");
for (const sample of samples) {
  console.log(`    ${byId.has(sample) ? "O" : "X"} ${sample} -> ${byId.get(sample) ?? ""}`);
}
console.log(
  "  템플릿 샘플:",
  JSON.stringify(templateRows.slice(0, 5).map((row) => `${row.id} -> ${row.ko}`), null, 0),
);
