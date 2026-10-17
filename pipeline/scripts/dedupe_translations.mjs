import { access, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

// Local-only tool: removes duplicate translation keys while keeping the exact
// semantics the extension and the search page rely on.
//
// Rules
//  - custom.json and keyword.json always win and are never dropped in favour of
//    another file.
//  - A key may exist once per table (different tables are context specific).
//  - Within one (key, table) group the row of the highest priority file wins,
//    which mirrors the userscript "first loaded wins" behaviour.
//  - If another row of the same (key, table) group matches the official Korean
//    balance data, that row wins instead (fixes wrong translations such as
//    "Crystalline Core of Knowledge V" => "지식의 결정체 핵 IV").
//
// Usage:
//   node scripts/dedupe_translations.mjs            (dry run, writes report)
//   node scripts/dedupe_translations.mjs --apply    (rewrites translations/)

const applyChanges = process.argv.includes("--apply");

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const balanceDirectory = path.join(projectRoot, "data", "balance");
const koreanDirectory = path.join(balanceDirectory, "korean");
const outputDirectory = path.join(projectRoot, "data", "poe_ninja_audit");
const backupDirectory = path.join(projectRoot, "data", "translations_backup_v1");

const DATA_FILES = [
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

const stripEnglishSuffix = (value) =>
  value
    .replace(/\s*\((?=[^)]*[A-Za-z])[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseJsonFile = async (filePath) =>
  JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));

const tableForFile = (fileName) => fileName.replace(/\.json$/, "");

const files = new Map();
const allRows = [];

for (const [loadOrder, fileName] of DATA_FILES.entries()) {
  const rawText = await readFile(
    path.join(translationDirectory, fileName),
    "utf8",
  );
  const payload = JSON.parse(rawText.replace(/^\uFEFF/, ""));
  const rows = [];

  if (Array.isArray(payload)) {
    payload.forEach((row, index) => {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        rows.push({
          fileName,
          loadOrder,
          index,
          id: row.id,
          ko: row.ko,
          table:
            typeof row.table === "string" ? row.table : tableForFile(fileName),
          key: normalizeEnglish(row.id),
        });
      }
    });
  } else if (payload && typeof payload === "object") {
    Object.entries(payload).forEach(([id, ko], index) => {
      if (typeof ko === "string") {
        rows.push({
          fileName,
          loadOrder,
          index,
          id,
          ko,
          table: tableForFile(fileName),
          key: normalizeEnglish(id),
        });
      }
    });
  }

  files.set(fileName, {
    payload,
    rows,
    isArray: Array.isArray(payload),
    trailingNewline: rawText.endsWith("\n"),
  });
  allRows.push(...rows);
}

const rowOrder = (row) => [row.loadOrder, row.index];

const groups = new Map();
for (const row of allRows) {
  if (!row.key) {
    continue;
  }
  const groupKey = `${row.key}\u0000${row.table}`;
  const list = groups.get(groupKey) ?? [];
  list.push(row);
  groups.set(groupKey, list);
}

const ambiguousKeys = new Set();
for (const [, list] of groups) {
  if (list.length < 2) {
    continue;
  }
  if (new Set(list.map((row) => row.ko)).size > 1) {
    ambiguousKeys.add(list[0].key);
  }
}

const officialIndex = new Map();
const koreanFiles = (await readdir(koreanDirectory)).filter((fileName) =>
  fileName.endsWith(".json"),
);
let pairedTables = 0;

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
  pairedTables += 1;

  const koreanById = new Map();
  const duplicatedIds = new Set();
  for (const row of koreanRows) {
    if (!row || typeof row.Id !== "string" || !row.Id) {
      continue;
    }
    if (koreanById.has(row.Id)) {
      duplicatedIds.add(row.Id);
      continue;
    }
    koreanById.set(row.Id, row);
  }

  for (const englishRow of englishRows) {
    if (!englishRow || typeof englishRow.Id !== "string") {
      continue;
    }
    if (duplicatedIds.has(englishRow.Id)) {
      continue;
    }
    const koreanRow = koreanById.get(englishRow.Id);
    if (!koreanRow) {
      continue;
    }
    for (const [field, englishValue] of Object.entries(englishRow)) {
      if (field === "Id" || typeof englishValue !== "string") {
        continue;
      }
      const key = normalizeEnglish(englishValue);
      if (!key || !ambiguousKeys.has(key)) {
        continue;
      }
      const koreanValue = koreanRow[field];
      if (
        typeof koreanValue !== "string" ||
        !koreanValue.trim() ||
        englishValue === koreanValue
      ) {
        continue;
      }
      let perKorean = officialIndex.get(key);
      if (!perKorean) {
        perKorean = new Set();
        officialIndex.set(key, perKorean);
      }
      perKorean.add(koreanValue.trim());
    }
  }
}

const removals = new Map();
const decisions = [];

for (const [groupKey, list] of groups) {
  if (list.length < 2) {
    continue;
  }
  const sorted = [...list].sort(
    (a, b) => a.loadOrder - b.loadOrder || a.index - b.index,
  );
  let keeper = sorted[0];
  let reason = "duplicate-same-table";

  const officialKorean = officialIndex.get(keeper.key) ?? new Set();
  if (officialKorean.size > 0) {
    const matching = sorted.find(
      (row) =>
        officialKorean.has(row.ko) ||
        officialKorean.has(stripEnglishSuffix(row.ko)),
    );
    if (matching && matching !== keeper) {
      keeper = matching;
      reason = "official-correction";
    }
  }

  const dropped = list.filter((row) => row !== keeper);
  for (const row of dropped) {
    const indexSet = removals.get(row.fileName) ?? new Set();
    indexSet.add(row.index);
    removals.set(row.fileName, indexSet);
  }

  decisions.push({
    key: keeper.key,
    table: keeper.table,
    reason,
    keeper: {
      fileName: keeper.fileName,
      id: keeper.id,
      ko: keeper.ko,
      loadOrder: keeper.loadOrder,
    },
    dropped: dropped.map((row) => ({
      fileName: row.fileName,
      id: row.id,
      ko: row.ko,
    })),
    koValues: [...new Set(list.map((row) => row.ko))],
    officialKorean: [...officialKorean],
  });
}

const buildPayload = (file) => {
  const removed = removals.get(file.fileName) ?? new Set();
  if (removed.size === 0) {
    return file.payload;
  }
  if (file.isArray) {
    return file.payload.filter((_, index) => !removed.has(index));
  }
  const rebuilt = {};
  let index = 0;
  for (const [id, ko] of Object.entries(file.payload)) {
    if (!removed.has(index)) {
      rebuilt[id] = ko;
    }
    index += 1;
  }
  return rebuilt;
};

const newPayloads = new Map();
for (const [fileName, file] of files) {
  newPayloads.set(fileName, buildPayload({ ...file, fileName }));
}

const extractRows = (payload, fileName, loadOrder) => {
  const rows = [];
  if (Array.isArray(payload)) {
    payload.forEach((row, index) => {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        rows.push({
          fileName,
          loadOrder,
          index,
          id: row.id,
          ko: row.ko,
          table:
            typeof row.table === "string" ? row.table : tableForFile(fileName),
          key: normalizeEnglish(row.id),
        });
      }
    });
  } else if (payload && typeof payload === "object") {
    Object.entries(payload).forEach(([id, ko], index) => {
      if (typeof ko === "string") {
        rows.push({
          fileName,
          loadOrder,
          index,
          id,
          ko,
          table: tableForFile(fileName),
          key: normalizeEnglish(id),
        });
      }
    });
  }
  return rows;
};

const newRows = [];
for (const [fileName, payload] of newPayloads) {
  newRows.push(...extractRows(payload, fileName, DATA_FILES.indexOf(fileName)));
}

const effectiveMap = (rows) => {
  const map = new Map();
  const ordered = [...rows].sort(
    (a, b) => a.loadOrder - b.loadOrder || a.index - b.index,
  );
  for (const row of ordered) {
    if (!row.key) {
      continue;
    }
    if (
      row.fileName === "general/custom.json" ||
      row.fileName === "general/keyword.json"
    ) {
      map.set(row.key, row.ko);
    } else if (!map.has(row.key)) {
      map.set(row.key, row.ko);
    }
  }
  return map;
};

const firstValueByKeyAndTable = (rows) => {
  const map = new Map();
  const ordered = [...rows].sort(
    (a, b) => a.loadOrder - b.loadOrder || a.index - b.index,
  );
  for (const row of ordered) {
    if (!row.key) {
      continue;
    }
    const groupKey = `${row.key}\u0000${row.table}`;
    if (!map.has(groupKey)) {
      map.set(groupKey, row.ko);
    }
  }
  return map;
};

const oldEffective = effectiveMap(allRows);
const newEffective = effectiveMap(newRows);
const oldPerTable = firstValueByKeyAndTable(allRows);
const newPerTable = firstValueByKeyAndTable(newRows);

const effectiveChanges = [];
for (const [key, ko] of newEffective) {
  const previous = oldEffective.get(key);
  if (previous !== ko) {
    const decision = decisions.find((item) => item.key === key);
    effectiveChanges.push({
      key,
      previous,
      next: ko,
      explainedBy: decision ? decision.reason : "missing-decision",
    });
  }
}
const perTableChanges = [];
for (const [groupKey, ko] of newPerTable) {
  const previous = oldPerTable.get(groupKey);
  if (previous !== ko) {
    perTableChanges.push({ groupKey, previous, next: ko });
  }
}

const errors = [];
for (const key of oldEffective.keys()) {
  if (!newEffective.has(key)) {
    errors.push(`key disappeared: ${key}`);
  }
}
for (const [key, ko] of newEffective) {
  if (!oldEffective.has(key)) {
    errors.push(`key appeared: ${key} (${ko})`);
  }
}

const corrections = decisions.filter(
  (decision) => decision.reason === "official-correction",
);
const redundantRemovals = decisions.filter(
  (decision) => decision.reason !== "official-correction",
);
const removedRowCount = [...removals.values()].reduce(
  (sum, indexSet) => sum + indexSet.size,
  0,
);

const fileSummaries = [];
for (const [fileName, file] of files) {
  const removed = removals.get(fileName)?.size ?? 0;
  fileSummaries.push({
    fileName,
    before: file.rows.length,
    removed,
    after: file.rows.length - removed,
  });
}

const lines = [];
lines.push(
  `poe.ninja 한글 DB 중복 정리 ${applyChanges ? "(적용)" : "(dry run)"}`,
);
lines.push(`총 항목: ${allRows.length} -> ${allRows.length - removedRowCount}`);
lines.push(`고유 키: ${oldEffective.size}`);
lines.push(`중복 그룹(키+테이블): ${decisions.length}`);
lines.push(`  - 순수 중복 제거: ${redundantRemovals.length}`);
lines.push(`  - 공식 한글 정정: ${corrections.length}`);
lines.push(`제거 항목 수: ${removedRowCount}`);
lines.push("");
lines.push("[파일별 변화]");
lines.push("파일 | 이전 | 제거 | 이후");
for (const summary of fileSummaries) {
  lines.push(
    `${summary.fileName} | ${summary.before} | ${summary.removed} | ${summary.after}`,
  );
}
lines.push("");
lines.push(`[공식 한글 기준 정정 ${corrections.length}건]`);
for (const decision of corrections) {
  lines.push(`* ${decision.key} (${decision.table})`);
  lines.push(
    `  적용: ${decision.keeper.ko} (${decision.keeper.fileName}:${decision.keeper.id})`,
  );
  for (const row of decision.dropped) {
    lines.push(`  제거: ${row.ko} (${row.fileName}:${row.id})`);
  }
  lines.push(`  공식 한글: ${decision.officialKorean.join(" | ")}`);
}
lines.push("");
lines.push(`[확장 표시값 변경 ${effectiveChanges.length}건]`);
for (const change of effectiveChanges) {
  lines.push(
    `* ${change.key}: "${change.previous}" -> "${change.next}" (${change.explainedBy})`,
  );
}
lines.push("");
lines.push(`[(키+테이블) 첫 값 변경 ${perTableChanges.length}건]`);
for (const change of perTableChanges) {
  const separator = change.groupKey.indexOf("\u0000");
  lines.push(
    `* ${change.groupKey.slice(0, separator)} [${change.groupKey.slice(separator + 1)}]: "${change.previous}" -> "${change.next}"`,
  );
}
lines.push("");
lines.push(
  `[순수 중복 제거 ${redundantRemovals.length}건 · 상위 80건]`,
);
for (const decision of redundantRemovals.slice(0, 80)) {
  const droppedFiles = [
    ...new Set(decision.dropped.map((row) => row.fileName)),
  ].join(", ");
  const valueNote =
    decision.koValues.length > 1
      ? ` | 값 차이: ${decision.koValues.join(" | ")}`
      : "";
  lines.push(
    `* ${decision.key} [${decision.table}] 유지: ${decision.keeper.fileName} "${decision.keeper.ko}" | 제거: ${droppedFiles}${valueNote}`,
  );
}
if (errors.length > 0) {
  lines.push("");
  lines.push(`[검증 오류 ${errors.length}건]`);
  for (const error of errors.slice(0, 40)) {
    lines.push(`  ${error}`);
  }
}

const reportText = `${lines.join("\r\n")}\r\n`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "dedupe-report.txt"),
  reportText,
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "dedupe-report.json"),
  JSON.stringify(
    {
      applied: applyChanges,
      totals: {
        entriesBefore: allRows.length,
        entriesAfter: allRows.length - removedRowCount,
        removedRows: removedRowCount,
        uniqueKeys: oldEffective.size,
        duplicateGroups: decisions.length,
        redundantRemovals: redundantRemovals.length,
        corrections: corrections.length,
        officialTablesPaired: pairedTables,
      },
      fileSummaries,
      effectiveChanges,
      perTableChanges,
      corrections,
      decisions,
      errors,
    },
    null,
    2,
  ),
  "utf8",
);

if (applyChanges) {
  if (errors.length > 0) {
    throw new Error(
      `Refusing to apply because validation reported ${errors.length} error(s)`,
    );
  }
  await mkdir(backupDirectory, { recursive: true });
  for (const [fileName] of files) {
    const backupPath = path.join(backupDirectory, fileName);
    const exists = await access(backupPath).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await cp(path.join(translationDirectory, fileName), backupPath);
    }
  }
  for (const [fileName, payload] of newPayloads) {
    const trailingNewline = files.get(fileName).trailingNewline;
    await writeFile(
      path.join(translationDirectory, fileName),
      `${JSON.stringify(payload, null, 2)}${trailingNewline ? "\n" : ""}`,
      "utf8",
    );
  }
}

console.log(`entries            : ${allRows.length} -> ${allRows.length - removedRowCount}`);
console.log(`duplicate groups   : ${decisions.length}`);
console.log(`  redundant        : ${redundantRemovals.length}`);
console.log(`  official fixes   : ${corrections.length}`);
console.log(`rows removed       : ${removedRowCount}`);
console.log(`effective changes  : ${effectiveChanges.length}`);
console.log(`per-table changes  : ${perTableChanges.length}`);
console.log(`validation errors  : ${errors.length}`);
console.log("per file:");
for (const summary of fileSummaries) {
  console.log(
    `  ${summary.fileName.padEnd(28)} ${summary.before} -> ${summary.after} (-${summary.removed})`,
  );
}
console.log(`mode               : ${applyChanges ? "APPLIED" : "dry run"}`);
console.log(`report: ${path.join(outputDirectory, "dedupe-report.txt")}`);



