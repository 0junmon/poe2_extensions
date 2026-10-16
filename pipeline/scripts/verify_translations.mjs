import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { createTranslator } from "../index.js";

// Local-only verification: loads the translation files through the same code
// path the search page uses and checks integrity of the deduplicated data.
//
// Usage: node scripts/verify_translations.mjs

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");

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
  "general/keyword.json",
  "general/custom.json",
];
const INTERFACE_FILE = "general/poe_ninja.json";

const normalizeEnglish = (value) =>
  value
    .replace(/_/g, " ")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");

const parse = async (fileName) =>
  JSON.parse(
    (await readFile(path.join(translationDirectory, fileName), "utf8")).replace(
      /^\uFEFF/,
      "",
    ),
  );

const failures = [];
const payloads = new Map();
for (const fileName of [...DATA_FILES, INTERFACE_FILE]) {
  const payload = await parse(fileName).catch((error) => {
    failures.push(`${fileName}: invalid JSON (${error.message})`);
    return null;
  });
  payloads.set(fileName, payload);
}

const rowsOf = (fileName) => {
  const payload = payloads.get(fileName);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    return Object.entries(payload).map(([id, ko]) => ({ id, ko }));
  }
  return [];
};

const perTableSeen = new Map();
let totalRows = 0;
for (const fileName of DATA_FILES) {
  for (const row of rowsOf(fileName)) {
    totalRows += 1;
    if (typeof row.id !== "string" || typeof row.ko !== "string") {
      failures.push(`${fileName}: row without string id/ko`);
      continue;
    }
    const table =
      typeof row.table === "string"
        ? row.table
        : fileName.replace(/\.json$/, "");
    const groupKey = `${normalizeEnglish(row.id)}\u0000${table}`;
    const seen = perTableSeen.get(groupKey) ?? [];
    seen.push(`${fileName}:${row.id}`);
    perTableSeen.set(groupKey, seen);
  }
}
for (const [groupKey, entries] of perTableSeen) {
  if (entries.length > 1) {
    const separator = groupKey.indexOf("\u0000");
    failures.push(
      `duplicate (key, table): ${groupKey.slice(0, separator)} [${groupKey.slice(separator + 1)}] -> ${entries.join(", ")}`,
    );
  }
}

const rows = rowsOf("names/game_terms.json");
if (rows.length === 0) {
  failures.push("names/game_terms.json: no rows");
}

const keywordRows = payloads.get("general/keyword.json");
const customRows = payloads.get("general/custom.json");

// keyword.json / custom.json 은 {id, ko} 배열과 {영문: 한글} 객체 둘 다 허용한다.
const payloadRows = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    return Object.entries(payload).map(([id, ko]) => ({
      id,
      ko,
      table: "custom",
    }));
  }
  return [];
};

const translator = createTranslator({
  compact: payloads.get("names/game_terms.json"),
  words: payloads.get("names/name_dictionary.json"),
  baseitemtypes: payloads.get("items/base_items.json"),
  itemclasscategories: payloads.get("items/item_classes.json"),
  uniqueitems: payloads.get("items/unique_items.json"),
  classes: payloads.get("names/character_classes.json"),
  custom: [...payloadRows(keywordRows), ...payloadRows(customRows)],
});

const interfacePayload = payloads.get(INTERFACE_FILE);
const samples = [
  "Ground Slam",
  "Runic Ward",
  "Evasion Rating",
  "Blackheart",
  "Warrior",
];
console.log("--- sample translations through index.js ---");
for (const sample of samples) {
  const matches = translator.translate(sample);
  console.log(
    `${sample.padEnd(18)} -> ${matches.map((row) => `${row.ko} (${row.table})`).join(", ") || "<none>"}`,
  );
}
console.log(
  `interface entries  : ${Object.keys(interfacePayload ?? {}).length}`,
);
console.log(
  `reverse("대지 강타") : ${translator.reverseTranslate("대지 강타").map((row) => `${row.id} (${row.table})`).join(", ") || "<none>"}`,
);
console.log(
  `searchKorean("회피") : ${translator.searchKorean("회피").length} row(s)`,
);
console.log(`rows checked       : ${totalRows}`);
console.log(`(key, table) pairs : ${perTableSeen.size}`);
console.log(`failures           : ${failures.length}`);
for (const failure of failures.slice(0, 20)) {
  console.log(`  ${failure}`);
}
process.exitCode = failures.length > 0 ? 1 : 0;
