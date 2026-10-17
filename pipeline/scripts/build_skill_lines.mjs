// Builds translations/skill_lines.json: a line level English -> Korean table for
// skill gem tooltips, assembled from the game's own balance tables.
//
//   clientstrings.json        tooltip labels and value formats ("Attack Speed", "{0}% of base")
//   gemtags.json              skill tags ("[Melee|근접]")
//   grantedeffectlabels.json  section headings ("Initial Strike" -> "최초 타격")
//   activeskills.json         skill name and description
//   skillgeminfo.json         gem info description
//
// Lines that only exist in the GGPK's Data/StatDescriptions/*.csd files (for
// example "Cannot cause Stun buildup") are not part of this file yet; the .csd
// files hold the stat description templates and are not part of the balance
// tables. See chrome-extension/INSTALL.md.
//
//   node scripts/build_skill_lines.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputFile = path.join(projectRoot, "translations", "lines/skill_gem_lines.json");

// Balance tables that are useful for a skill gem tooltip.
const CLIENT_STRING_ID_PATTERNS = [
  /^ItemDisplay/,
  /^ItemDisplayGrantedSkill/,
  /^ItemDisplayGrantsSkill/,
  /^ItemDescription/,
  /^ItemRequirements/,
  /^ItemLevel/,
  /^ItemPopup/,
  /^SkillPopup/,
  /^SupportGem/,
  /^SupportFamily/,
  /^SkillGem/,
  /^Gem/,
  /^PercentageOfBase$/,
  /^NumberRange$/,
  /^Tier$/,
  /^Level$/,
  /^Orb(Mana|Life)Value$/,
  /^SortMethodQuality$/,
  /^GraphicsTabQualitySuffix$/,
];

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const loadTable = (fileName) => readJson(path.join(balanceDirectory, fileName));
const loadKorean = (fileName) => readJson(path.join(koreanDirectory, fileName));

// `{0}` is the game's placeholder for a number; the extension matches numbers
// through `#`, so the placeholder is converted here.
const placeholdersToHash = (text) => text.replace(/\{(\d+)\}/g, "#");
const placeholderIndices = (text) => [...text.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
const isSequential = (indices) => indices.every((value, index) => value === index);
// `[id|display]` / `[name]` keyword links are left as they are; the final data clean up
// (scripts/clean_translations.mjs) keeps the last `|` segment. `<white>` are colour tags and
// `{...}` marks highlighted text, so only the displayed text survives here.
const stripMarkup = (text) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLine = (text) =>
  typeof text === "string" ? stripMarkup(placeholdersToHash(text)) : "";
// A Korean line may use the values in another order ("Recovers {0} Life over
// {1} Seconds" -> "{1}초 동안 {0} 생명력 회복"), so such a line keeps its indexed
// placeholders and the content script maps them back to the captured values.
const PLACEHOLDER_GUARD = "\u0001";
// The extension no longer renders " / " as a separator; keep it out of the
// generated Korean lines as well.
const normalizeDisplaySeparators = (text) => text.replace(/ \/ /g, " · ");
const normalizeKoreanLine = (text) => {
  if (typeof text !== "string") {
    return "";
  }
  if (isSequential(placeholderIndices(text))) {
    return normalizeDisplaySeparators(stripMarkup(placeholdersToHash(text)));
  }
  const guarded = text.replace(/\{(\d+)\}/g, `${PLACEHOLDER_GUARD}$1${PLACEHOLDER_GUARD}`);
  return normalizeDisplaySeparators(
    stripMarkup(guarded).replace(
      new RegExp(`${PLACEHOLDER_GUARD}(\\d+)${PLACEHOLDER_GUARD}`, "g"),
      "{$1}",
    ),
  );
};

const rows = new Map();
const stats = { added: {}, empty: 0, workInProgress: 0, identical: 0, conflict: 0, placeholderOrder: 0 };

function add(english, korean, source) {
  const id = normalizeLine(english);
  const ko = normalizeKoreanLine(korean);
  if (!id || !ko) {
    stats.empty += 1;
    return;
  }
  if (typeof english === "string" && !isSequential(placeholderIndices(english))) {
    // The English side is the pattern source, so a reordered English placeholder would
    // scramble the captured values; those rows are left out.
    stats.placeholderOrder += 1;
    return;
  }
  if (/^(wip|\[dnt|dnt)/i.test(ko)) {
    stats.workInProgress += 1;
    return;
  }
  const existing = rows.get(id);
  if (existing) {
    if (existing.ko !== ko) {
      stats.conflict += 1;
    }
    return;
  }
  if (!id.includes("#") && id === ko) {
    stats.identical += 1;
    return;
  }
  if (!/\[(DNT-)?UNUSED\]/i.test(id) && !/\[(DNT-)?UNUSED\]/i.test(ko)) {
    rows.set(id, { id, ko });
  }
  stats.added[source] = (stats.added[source] ?? 0) + 1;
}

// 1. ClientStrings: the labels and value formats the gem tooltip is built from.
{
  const english = loadTable("clientstrings.json");
  const koreanById = new Map(loadKorean("clientstrings.json").map((row) => [row.Id, row.Text]));
  for (const row of english) {
    if (typeof row.Text !== "string" || !row.Text.trim()) {
      continue;
    }
    if (!CLIENT_STRING_ID_PATTERNS.some((pattern) => pattern.test(row.Id ?? ""))) {
      continue;
    }
    add(row.Text, koreanById.get(row.Id), "clientstrings");
  }
}

// 2. Keyword style tables that already store "[id|display]" values.
for (const [fileName, field] of [
  ["gemtags.json", "Name"],
  ["grantedeffectlabels.json", "Text"],
]) {
  const english = loadTable(fileName);
  const koreanById = new Map(loadKorean(fileName).map((row) => [row.Id, row[field]]));
  for (const row of english) {
    add(row[field], koreanById.get(row.Id), fileName.replace(".json", ""));
  }
}

// 3. Skill names and descriptions.
{
  const english = loadTable("activeskills.json");
  const koreanById = new Map(loadKorean("activeskills.json").map((row) => [row.Id, row]));
  for (const row of english) {
    const korean = koreanById.get(row.Id);
    if (!korean) {
      continue;
    }
    add(row.DisplayedName, korean.DisplayedName, "activeskills.name");
    add(row.Description, korean.Description, "activeskills.description");
    // An item that grants a skill prints "Grants Skill: Level 20 <Skill>"
    // ("스킬 부여: 20레벨 <스킬>"). The trade API only lists the skills an item mod
    // can grant, so the line is generated for every named skill of the game.
    if (
      typeof row.DisplayedName === "string" &&
      row.DisplayedName &&
      typeof korean.DisplayedName === "string" &&
      korean.DisplayedName &&
      !/^\[?dnt/i.test(row.DisplayedName)
    ) {
      add(
        `Grants Skill: Level {0} ${row.DisplayedName}`,
        `스킬 부여: {0}레벨 ${korean.DisplayedName}`,
        "activeskills.grantedSkill",
      );
    }
  }
}

// 4. Gem info descriptions.
{
  const english = loadTable("skillgeminfo.json");
  const koreanById = new Map(loadKorean("skillgeminfo.json").map((row) => [row.Id, row.Description]));
  for (const row of english) {
    add(row.Description, koreanById.get(row.Id), "skillgeminfo");
  }
}

// 4b. Support gem descriptions: "Supports Attack Skills, causing them to Cull ..." is the
//     SupportText of gemeffects.json, paired with the Korean dump by row id.
{
  const english = loadTable("gemeffects.json");
  const koreanById = new Map(
    loadKorean("gemeffects.json").map((row) => [row.Id, row.SupportText]),
  );
  for (const row of english) {
    if (typeof row.SupportText === "string" && row.SupportText.trim()) {
      add(row.SupportText, koreanById.get(row.Id), "gemeffects");
    }
  }
}

// 4c. Support gem families ("Nova Projectiles", "Culling Strike"): the family name is
//     printed as the Category of a support gem tooltip.
{
  const english = loadTable("supportgemfamily.json");
  const koreanById = new Map(
    loadKorean("supportgemfamily.json").map((row) => [row.Id, row.Text]),
  );
  for (const row of english) {
    if (typeof row.Text === "string" && row.Text.trim()) {
      add(row.Text, koreanById.get(row.Id), "supportgemfamily");
    }
  }
}

// 4d. Quality types: the item tooltip prints the quality type as "Quality (Fire
//     Modifiers)" ("퀄리티 (화염 속성 부여)").
{
  const english = loadTable("alternatequalitytypes.json");
  const koreanById = new Map(
    loadKorean("alternatequalitytypes.json").map((row) => [row.Id, row.Description]),
  );
  for (const row of english) {
    if (typeof row.Description === "string" && row.Description.trim()) {
      add(row.Description, koreanById.get(row.Id), "alternatequalitytypes");
    }
  }
}

// 5. Item classes used by "Requires: ..." lines. itemclass_singulars.json maps a
//    plural class name to its singular name and itemclasscategories.json maps the
//    class id to Korean, so "One Hand Maces" becomes "한손 철퇴".
{
  const singulars = readJson(
    path.join(projectRoot, "translations", "items/item_class_singulars.json"),
  );
  const categories = readJson(
    path.join(projectRoot, "translations", "items/item_classes.json"),
  );
  const koreanFor = (name) => {
    if (typeof name !== "string") {
      return undefined;
    }
    return categories[name] ?? categories[name.replace(/s$/, "")];
  };
  const pairs =
    singulars.custom || singulars.generated
      ? { ...(singulars.custom ?? {}), ...(singulars.generated ?? {}) }
      : singulars;
  for (const [plural, singular] of Object.entries(pairs)) {
    const korean = koreanFor(singular) ?? koreanFor(plural);
    if (korean) {
      add(plural, korean, "itemclass_singulars");
    }
  }
}

// Tooltips show value ranges as "(1—20)"; the extension accepts a bracketed range
// for every number placeholder, so no range variants are stored here.

const sorted = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${sorted.length} rows to ${outputFile}`);
console.log("  per source:", JSON.stringify(stats.added, null, 0));
console.log(
  `  skipped: empty ${stats.empty}, WIP ${stats.workInProgress}, identical ${stats.identical}, conflicting Korean ${stats.conflict}, reordered English placeholders ${stats.placeholderOrder}`,
);
const templateRows = sorted.filter((row) => row.id.includes("#"));
console.log(`  templates with a number placeholder: ${templateRows.length}`);
console.log("  template samples:", JSON.stringify(templateRows.slice(0, 8).map((row) => `${row.id} -> ${row.ko}`)));
