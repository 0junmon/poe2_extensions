// Dependency-free checks for the translation data and the matching rules used
// by core/content.js. No browser or Playwright is required.
//
//   node scripts/verify_translation_rules.mjs
//   node scripts/verify_translation_rules.mjs --strict-dist
//
// Exit code 1 means a data error that would make a row silently unusable.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./project-root.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.resolve(scriptDirectory, "..", "..");
const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const strictDist = process.argv.includes("--strict-dist");

const INTERFACE_FILE = "general/poe_ninja.json";
const CORE_DATA_FILES = [
  "names/game_terms.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
];
const OPTIONAL_CORE_DATA_FILES = [
  "names/mods.json",
  "names/keywordpopups.json",
  "items/base_item_variants.json",
];
const STAT_LINE_DATA_FILES = [
  "lines/item_mod_lines.json",
  "lines/skill_gem_lines.json",
  "lines/stat_lines.json",
  "lines/flavour_text.json",
  "lines/keyword_definitions.json",
  "names/area_and_quest_names.json",
];
const KEYWORD_DATA_FILE = "general/keyword.json";
const CUSTOM_DATA_FILE = "general/custom.json";
const ALL_DATA_FILES = [
  ...new Set([
    INTERFACE_FILE,
    ...CORE_DATA_FILES,
    ...OPTIONAL_CORE_DATA_FILES,
    ...STAT_LINE_DATA_FILES,
    KEYWORD_DATA_FILE,
    CUSTOM_DATA_FILE,
  ]),
];

const errors = [];
const warnings = [];
const exact = new Map();
const exactOccurrences = new Map();
const statTemplates = new Map();
const statOccurrences = new Map();
const namedTemplates = new Map();
const namedOccurrences = new Map();

const normalizeEnglish = (value) =>
  value
    .replace(/_/g, " ")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");

const parseIndices = (text) =>
  [...text.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
const hasNamedPlaceholder = (text) => /\{\d+\}/.test(text);
const countHashes = (text) => (text.match(/#/g) ?? []).length;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function recordOccurrence(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function addExact(english, korean, file, override) {
  if (typeof english !== "string" || typeof korean !== "string") {
    return;
  }
  const id = english.trim();
  const ko = korean.trim();
  if (!id || !ko) {
    errors.push(`${file}: row with an empty id or ko`);
    return;
  }
  if (!id.includes("#") && ko.includes("#")) {
    errors.push(`${file}: "${id}" has # in Korean but not in the id`);
  }
  if (!hasNamedPlaceholder(id) && hasNamedPlaceholder(ko)) {
    errors.push(`${file}: "${id}" has {n} in Korean but not in the id`);
  }
  const key = normalizeEnglish(id);
  recordOccurrence(exactOccurrences, key, { file, ko });
  if (override) {
    exact.set(key, { ko, file });
  } else if (!exact.has(key)) {
    exact.set(key, { ko, file });
  }
}

function addNamedTemplate(english, korean, file, override) {
  const id = english.trim();
  const ko = korean.trim();
  const englishIndices = parseIndices(id);
  if (englishIndices.length === 0) {
    return;
  }
  const koreanIndices = parseIndices(ko);
  if (koreanIndices.length === 0) {
    errors.push(`${file}: "${id}" has {n} but the Korean value has none`);
    return;
  }
  const allowed = new Set(englishIndices);
  const missing = [...new Set(koreanIndices)].filter(
    (index) => !allowed.has(index),
  );
  if (missing.length > 0) {
    errors.push(
      `${file}: "${id}" Korean uses missing index(es) ${missing.join(", ")}`,
    );
  }
  const key = normalizeEnglish(id);
  recordOccurrence(namedOccurrences, key, { file, ko });
  const entry = { key, ko, file, englishIndices };
  if (override || !namedTemplates.has(key)) {
    namedTemplates.set(key, entry);
  }
}

function addStatTemplate(english, korean, file, override) {
  const id = english.trim();
  const ko = korean.trim();
  const valueCount = countHashes(id);
  if (valueCount === 0) {
    return;
  }
  const koreanIndices = parseIndices(ko);
  const koreanHashes = countHashes(ko);
  if (koreanIndices.length > 0) {
    if (koreanHashes > 0) {
      errors.push(`${file}: "${id}" mixes # and {n} in the Korean value`);
    }
    const missing = [...new Set(koreanIndices)].filter(
      (index) => index < 0 || index >= valueCount,
    );
    if (missing.length > 0) {
      errors.push(
        `${file}: "${id}" Korean index(es) ${missing.join(", ")} exceed ${valueCount} value(s)`,
      );
    }
  } else if (koreanHashes !== valueCount) {
    const message = `${file}: "${id}" has ${valueCount} # value(s) but Korean has ${koreanHashes}`;
    // Flavour text and area names can contain a literal "#120"/"draft #1";
    // content.js treats every # as a value, so those rows stay untranslated
    // instead of breaking the build. They are reported as warnings.
    const literalHashFiles = new Set([
      "lines/flavour_text.json",
      "names/area_and_quest_names.json",
    ]);
    (literalHashFiles.has(file) ? warnings : errors).push(message);
  }
  const key = normalizeEnglish(id);
  recordOccurrence(statOccurrences, key, { file, ko });
  const entry = { key, ko, file, valueCount };
  if (override || !statTemplates.has(key)) {
    statTemplates.set(key, entry);
  }
}

function addArrayRows(rows, file, override = false) {
  if (!Array.isArray(rows)) {
    errors.push(`${file}: expected an array`);
    return;
  }
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || typeof row.ko !== "string") {
      errors.push(`${file}: row without a string id/ko`);
      continue;
    }
    const id = row.id.trim();
    const ko = row.ko.trim();
    if (hasNamedPlaceholder(id) !== hasNamedPlaceholder(ko)) {
      errors.push(`${file}: "${id}" has a {n} placeholder on only one side`);
    }
    if (id.includes("#")) {
      warnings.push(`${file}: "${id}" uses # outside a stat line file`);
    }
    if (hasNamedPlaceholder(id) && hasNamedPlaceholder(ko)) {
      addNamedTemplate(id, ko, file, override);
    }
    addExact(id, ko, file, override);
  }
}

function addStatRows(rows, file, override = false) {
  if (!Array.isArray(rows)) {
    errors.push(`${file}: expected an array`);
    return;
  }
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || typeof row.ko !== "string") {
      errors.push(`${file}: row without a string id/ko`);
      continue;
    }
    if (row.id.includes("#")) {
      addStatTemplate(row.id, row.ko, file, override);
    } else {
      addExact(row.id, row.ko, file, override);
    }
  }
}

function addObjectRows(object, file, override = false) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    errors.push(`${file}: expected an object`);
    return;
  }
  for (const [english, korean] of Object.entries(object)) {
    if (typeof korean !== "string") {
      errors.push(`${file}: "${english}" does not have a string value`);
      continue;
    }
    if (hasNamedPlaceholder(english) !== hasNamedPlaceholder(korean)) {
      errors.push(`${file}: "${english}" has a {n} placeholder on only one side`);
    }
    if (hasNamedPlaceholder(english) && hasNamedPlaceholder(korean)) {
      addNamedTemplate(english, korean, file, override);
    }
    addExact(english, korean, file, override);
  }
}

function addCustom(data, file, override = true) {
  if (Array.isArray(data)) {
    const statRows = data.filter(
      (row) => row && typeof row.id === "string" && row.id.includes("#"),
    );
    const otherRows = data.filter((row) => !statRows.includes(row));
    if (otherRows.length > 0) {
      addArrayRows(otherRows, file, override);
    }
    if (statRows.length > 0) {
      addStatRows(statRows, file, override);
    }
    return;
  }
  addObjectRows(data, file, override);
}

async function readJson(file, { required = false } = {}) {
  const filePath = path.join(translationDirectory, file);
  if (!existsSync(filePath)) {
    (required ? errors : warnings).push(`${file}: missing`);
    return undefined;
  }
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function reportConflicts(label, occurrences) {
  const conflicts = [];
  for (const [key, list] of occurrences) {
    const values = new Set(list.map((entry) => entry.ko.trim()));
    if (values.size > 1) {
      conflicts.push({
        key,
        files: [...new Set(list.map((entry) => entry.file))],
        values: [...values],
      });
    }
  }
  if (conflicts.length === 0) {
    return;
  }
  const sample = conflicts
    .slice(0, 5)
    .map(
      (entry) =>
        `  - ${entry.key} (${entry.files.join(", ")}): ${entry.values.join(" | ")}`,
    )
    .join("\n");
  warnings.push(
    `${label}: ${conflicts.length} duplicate key(s) with different Korean values (load order decides)\n${sample}`,
  );
}

function firstWord(text) {
  const match = text.match(/^[a-z][a-z'.]*/);
  return match ? match[0] : null;
}

function checkTemplateShadowing() {
  const exactByFirstWord = new Map();
  for (const key of exact.keys()) {
    if (key.includes("#") || hasNamedPlaceholder(key)) {
      continue;
    }
    const word = firstWord(key);
    if (!word) {
      continue;
    }
    const bucket = exactByFirstWord.get(word) ?? [];
    bucket.push(key);
    exactByFirstWord.set(word, bucket);
  }

  const shadowed = [];
  const check = (templateKey, splitPattern) => {
    const literalPrefix = templateKey.split(splitPattern)[0];
    const word = firstWord(literalPrefix);
    if (!word) {
      return;
    }
    const keys = exactByFirstWord.get(word) ?? [];
    const parts = templateKey.split(splitPattern);
    const pattern = new RegExp(
      `^${parts.map((part) => escapeRegExp(part)).join("(.+?)")}$`,
    );
    for (const key of keys) {
      if (pattern.test(key)) {
        shadowed.push({ key, templateKey });
        break;
      }
    }
  };
  for (const templateKey of statTemplates.keys()) {
    check(templateKey, "#");
  }
  for (const templateKey of namedTemplates.keys()) {
    check(templateKey, /\{\d+\}/g);
  }

  if (shadowed.length > 0) {
    const sample = shadowed
      .slice(0, 5)
      .map(
        (entry) =>
          `  - "${entry.key}" also matches template "${entry.templateKey}"`,
      )
      .join("\n");
    warnings.push(
      `exact keys that also match a template (exact wins): ${shadowed.length}\n${sample}`,
    );
  }
}

function checkNumericVariants() {
  const numeric = /^(hour|week|day|act) \d+$/;
  const unique =
    /^unique (weapons|armours|accessories|charms|flasks|jewels|relics|tablets)$/;
  const hits = [...exact.keys()].filter(
    (key) => numeric.test(key) || unique.test(key),
  );
  if (hits.length > 0) {
    warnings.push(
      `hard-coded variants that may belong in a {0} template: ${hits.length} (${hits
        .slice(0, 5)
        .join(", ")})`,
    );
  }
}

async function checkDist() {
  const distDirectory = path.join(
    codeRoot,
    "dist",
    "poe-ninja-korean",
    "translations",
  );
  if (!existsSync(distDirectory)) {
    warnings.push(
      "dist/poe-ninja-korean is not built; skipped the dist sync check",
    );
    return;
  }
  const hash = async (filePath) =>
    createHash("sha256").update(await readFile(filePath)).digest("hex");
  const mismatches = [];
  for (const file of ALL_DATA_FILES) {
    const source = path.join(translationDirectory, file);
    const copy = path.join(distDirectory, file);
    if (!existsSync(copy)) {
      mismatches.push(`${file}: missing from dist`);
      continue;
    }
    if ((await hash(source)) !== (await hash(copy))) {
      mismatches.push(`${file}: differs from dist`);
    }
  }
  if (mismatches.length > 0) {
    const message = `dist is stale (${mismatches.length}): ${mismatches
      .slice(0, 5)
      .join(", ")} — run build:extension`;
    (strictDist ? errors : warnings).push(message);
  }
}

if (!existsSync(translationDirectory)) {
  console.error(`translations/ not found: ${translationDirectory}`);
  process.exit(1);
}

const interfaceData = await readJson(INTERFACE_FILE, { required: true });
if (interfaceData !== undefined) {
  addObjectRows(interfaceData, INTERFACE_FILE);
}
for (const file of CORE_DATA_FILES) {
  const data = await readJson(file, { required: true });
  if (Array.isArray(data)) {
    addArrayRows(data, file);
  } else if (data !== undefined) {
    addObjectRows(data, file);
  }
}
for (const file of OPTIONAL_CORE_DATA_FILES) {
  const data = await readJson(file);
  if (Array.isArray(data)) {
    addArrayRows(data, file);
  } else if (data !== undefined) {
    addObjectRows(data, file);
  }
}
for (const file of STAT_LINE_DATA_FILES) {
  const data = await readJson(file, { required: true });
  if (data !== undefined) {
    addStatRows(data, file);
  }
}
const keywordData = await readJson(KEYWORD_DATA_FILE);
if (keywordData !== undefined) {
  addCustom(keywordData, KEYWORD_DATA_FILE);
}
const customData = await readJson(CUSTOM_DATA_FILE);
if (customData !== undefined) {
  addCustom(customData, CUSTOM_DATA_FILE);
}

reportConflicts("exact translations", exactOccurrences);
reportConflicts("# templates", statOccurrences);
reportConflicts("{n} templates", namedOccurrences);
checkTemplateShadowing();
checkNumericVariants();
await checkDist();

console.log(`Data root: ${projectRoot}`);
console.log(
  `Exact: ${exact.size}, # templates: ${statTemplates.size}, {n} templates: ${namedTemplates.size}`,
);
if (warnings.length > 0) {
  console.warn(`\nWarnings (${warnings.length}):`);
  for (const warning of warnings.slice(0, 20)) {
    console.warn(`- ${warning}`);
  }
  if (warnings.length > 20) {
    console.warn(`- ... ${warnings.length - 20} more`);
  }
}
if (errors.length > 0) {
  console.error(`\nErrors (${errors.length}):`);
  for (const error of errors.slice(0, 50)) {
    console.error(`- ${error}`);
  }
  if (errors.length > 50) {
    console.error(`- ... ${errors.length - 50} more`);
  }
  process.exit(1);
}
console.log("\nOK");
