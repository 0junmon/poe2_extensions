// 번역 데이터 구조 정리. 조회에 쓰이지 않는 것들을 걷어내 중복을 없앤다.
//
//   1) ko 안의 "(id)" 괄호 제거          "불의 화신(Avatar of Fire)" -> "불의 화신"
//   2) id 와 ko 가 같은 항목 제거         "Navira" -> "Navira"  (번역이 없는 항목)
//   3) table 필드 제거                    조회는 id -> ko 만 쓴다
//   4) 같은 키는 한 행만 남김             custom.json -> keyword.json -> 로드 순서/파일 순서
//   5) "[...]" 마크업 정리                "[Jewel|주얼] 슬롯" -> "주얼 슬롯"
//      id 와 ko 양쪽이 대상이고, `[]` 안을 `|` 로 나눠 **마지막 조각**만 남긴다
//      (`|` 가 없으면 `[]` 만 벗겨낸다). 수집 단계는 마크업을 그대로 저장한다.
//
// 값이 갈리는 키는 공식 한글 대조가 있는 `scripts/dedupe_translations.mjs` 를 먼저 돌리면
// 좋다(그 도구는 table 별 맥락을 유지한다).
//
//   node scripts/clean_translations.mjs           (dry run — 파일을 쓰지 않고 리포트만)
//   node scripts/clean_translations.mjs --apply   (translations/ 재작성 + 백업)

import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const applyChanges = process.argv.includes("--apply");
const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const outputDirectory = path.join(projectRoot, "data", "poe_ninja_audit");
const backupDirectory = path.join(projectRoot, "data", "translations_backup_clean");

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
  "items/item_class_singulars.json",
  "lines/item_mod_lines.json",
  "lines/skill_gem_lines.json",
  "lines/stat_lines.json",
  "lines/flavour_text.json",
  "lines/keyword_definitions.json",
  "names/area_and_quest_names.json",
  "general/keyword.json",
  "general/custom.json",
];

// 직접 고치는 override 파일이 가장 세다(확장 프로그램과 같은 규칙).
const OVERRIDE_PRIORITY = ["general/custom.json", "general/keyword.json"];

// general/ 폴더의 파일은 poe.ninja 화면 라벨과 직접 고치는 값이라 중복이라도 버리지 않는다.
const KEEP_ALL_FILES = ["general/poe_ninja.json", "general/keyword.json", "general/custom.json"];
const KEEPS_ALL = (fileName) =>
  KEEP_ALL_FILES.includes(fileName) || REGISTRY_FILES.has(fileName);

// 단순 번역이 아니라 "목록/분류" 자체를 담는 파일. 확장 프로그램이 이 파일들로
// 고유 아이템 목록(고유 검색)과 기본 아이템 -> 아이템 분류(itemClass)를 만들기 때문에
// 다른 파일의 같은 키로 대체하면 기능이 깨진다. 그래서 여기서는 파일 안의 완전 중복만 지운다.
const REGISTRY_FILES = new Set([
  "items/unique_items.json",
  "items/base_items.json",
  "names/character_classes.json",
  "items/item_class_singulars.json",
]);

const normalize = (value) =>
  String(value)
    .replace(/_/g, " ")
    .replace(/['\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");

// "값(id|표시)" 안의 마크업을 정리한다. `[]` 안을 `|` 로 나눠 마지막 조각만 남기고, `|` 가 없으면
// `[]` 만 벗긴다("A [B|C] D" -> "A C D", "[Jewel] Socket" -> "Jewel Socket").
const stripBracketMarkup = (value) =>
  String(value).replace(/\[([^\]]*)\]/g, (match, inner) => {
    const parts = inner.split("|");
    return parts[parts.length - 1].trim();
  });

// "(...)" 안의 내용이 id 와 같을 때만 괄호를 지운다("지식의 결정체 핵 IV" 처럼 다른 괄호는 유지).
const stripIdParens = (korean, id) => {
  const key = normalize(id);
  if (!key) {
    return korean;
  }
  return korean
    .replace(/\s*\(([^()]*)\)/g, (match, inner) =>
      normalize(inner) === key ? "" : match,
    )
    .replace(/\s+/g, " ")
    .trim();
};

const rows = [];
const loads = new Map();
const cleanedKoByIndex = new Map();
const cleanedIdByIndex = new Map();
const tablesByFile = new Map();
let markupStrippedCount = 0;

for (const [loadOrder, fileName] of DATA_FILES.entries()) {
  const rawText = await readFile(
    path.join(translationDirectory, fileName),
    "utf8",
  );
  const payload = JSON.parse(rawText.replace(/^\uFEFF/, ""));
  const isArray = Array.isArray(payload);
  loads.set(fileName, { payload, isArray, trailingNewline: rawText.endsWith("\n") });
  const tables = new Set();
  if (isArray) {
    for (const row of payload) {
      if (row && typeof row.table === "string") {
        tables.add(row.table);
      }
    }
  }
  tablesByFile.set(fileName, tables);
  const entries = isArray
    ? payload.map((row, index) => [index, row?.id, row?.ko, JSON.stringify(row)])
    : Object.entries(payload).map(([id, ko], index) => [index, id, ko, ""]);
  for (const [index, rawId, rawKo, signature] of entries) {
    if (typeof rawId !== "string" || typeof rawKo !== "string") {
      continue;
    }
    const id = stripBracketMarkup(rawId);
    const koWithoutMarkup = stripBracketMarkup(rawKo);
    const cleaned = stripIdParens(koWithoutMarkup, id);
    const markupStripped = id !== rawId || koWithoutMarkup !== rawKo;
    if (markupStripped) {
      markupStrippedCount += 1;
    }
    if (id !== rawId) {
      cleanedIdByIndex.set(`${fileName}#${index}`, id);
    }
    cleanedKoByIndex.set(`${fileName}#${index}`, cleaned);
    rows.push({
      fileName,
      loadOrder,
      index,
      id,
      ko: cleaned,
      parenStripped: cleaned !== koWithoutMarkup,
      markupStripped,
      signature,
      key: normalize(id),
    });
  }
}

// 1) 괄호 제거 / 2) id == ko 제거
const dropped = new Set();
const keptRows = [];
let parenStrippedCount = 0;
let identicalCount = 0;
for (const row of rows) {
  if (row.parenStripped) {
    parenStrippedCount += 1;
  }
  if (!row.key) {
    dropped.add(row);
    continue;
  }
  if (!row.ko || normalize(row.ko) === row.key) {
    // 번역이 없거나(id == ko) 괄호만 남아 빈 값이 된 항목.
    identicalCount += 1;
    dropped.add(row);
    continue;
  }
  keptRows.push(row);
}

const priorityOf = (row) =>
  OVERRIDE_PRIORITY.includes(row.fileName)
    ? OVERRIDE_PRIORITY.indexOf(row.fileName)
    : OVERRIDE_PRIORITY.length;

// 4) 같은 키는 한 행만 (custom -> keyword -> 로드 순서 -> 파일 안 순서)
const groups = new Map();
for (const row of keptRows) {
  const list = groups.get(row.key) ?? [];
  list.push(row);
  groups.set(row.key, list);
}

const conflicts = [];
let mergedKeys = 0;
let mergedRows = 0;
for (const [key, list] of groups) {
  if (list.length < 2) {
    continue;
  }
  const values = [...new Set(list.map((row) => row.ko))];
  if (list.some((row) => KEEPS_ALL(row.fileName))) {
    // 레지스트리 파일(고유 아이템 목록 등)과 general/ 파일의 행은 다른 행으로 대체하지
    // 않는다. 같은 파일 안의 완전히 동일한 행만 지운다.
    const seen = new Set();
    for (const row of list) {
      const signature = `${row.fileName}\u0000${
        row.signature || `${row.key}#${row.index}`
      }`;
      if (seen.has(signature)) {
        dropped.add(row);
        mergedRows += 1;
        continue;
      }
      seen.add(signature);
    }
    continue;
  }
  if (values.length > 1) {
    // 키는 같은데 값이 갈리는 행은 지우지 않는다(값을 잃지 않기 위해 그대로 둔다).
    conflicts.push({
      key,
      kept: list[0].ko,
      keptFile: list[0].fileName,
      droppedValues: values.filter((value) => value !== list[0].ko),
      droppedFiles: [...new Set(list.slice(1).map((row) => row.fileName))],
      keptRows: true,
    });
    continue;
  }
  const sorted = [...list].sort(
    (a, b) =>
      priorityOf(a) - priorityOf(b) ||
      a.loadOrder - b.loadOrder ||
      a.index - b.index,
  );
  const [keeper, ...rest] = sorted;
  mergedKeys += 1;
  mergedRows += rest.length;
  for (const row of rest) {
    dropped.add(row);
  }
  const droppedValues = values.filter((value) => value !== keeper.ko);
  if (droppedValues.length > 0) {
    conflicts.push({
      key,
      kept: keeper.ko,
      keptFile: keeper.fileName,
      droppedValues,
      droppedFiles: [...new Set(rest.map((row) => row.fileName))],
    });
  }
}

// 3) table 필드 제거 + 위에서 정한 제거 목록 반영
const dropIndexes = new Map();
for (const row of dropped) {
  const set = dropIndexes.get(row.fileName) ?? new Set();
  set.add(row.index);
  dropIndexes.set(row.fileName, set);
}

const buildPayload = (fileName) => {
  const { payload, isArray } = loads.get(fileName);
  const drop = dropIndexes.get(fileName) ?? new Set();
  if (!isArray) {
    if (drop.size === 0) {
      return payload;
    }
    const rebuilt = {};
    let index = 0;
    for (const [id, ko] of Object.entries(payload)) {
      const position = index;
      index += 1;
      if (drop.has(position)) {
        continue;
      }
      const cleaned = cleanedKoByIndex.get(`${fileName}#${position}`);
      const cleanedId = cleanedIdByIndex.get(`${fileName}#${position}`);
      rebuilt[typeof cleanedId === "string" ? cleanedId : id] =
        typeof cleaned === "string" ? cleaned : ko;
    }
    return rebuilt;
  }
  const output = [];
  // 테이블이 하나뿐인 파일은 파일 이름이 곧 테이블이므로 table 키를 쓰지 않는다.
  const dropTable = (tablesByFile.get(fileName)?.size ?? 0) <= 1;
  payload.forEach((row, index) => {
    if (drop.has(index)) {
      return;
    }
    const next = { ...row };
    const cleanedId = cleanedIdByIndex.get(`${fileName}#${index}`);
    if (typeof cleanedId === "string") {
      next.id = cleanedId;
    }
    if (dropTable) {
      delete next.table;
    }
    const cleaned = cleanedKoByIndex.get(`${fileName}#${index}`);
    if (typeof cleaned === "string") {
      next.ko = cleaned;
    }
    output.push(next);
  });
  return output;
};

const perFile = [];
const newPayloads = new Map();
let afterTotal = 0;
for (const fileName of DATA_FILES) {
  const payload = buildPayload(fileName);
  newPayloads.set(fileName, payload);
  const before = rows.filter((row) => row.fileName === fileName).length;
  const after = Array.isArray(payload)
    ? payload.length
    : Object.keys(payload).length;
  afterTotal += after;
  perFile.push({ fileName, before, after });
}

const report = [
  `번역 데이터 구조 정리 ${applyChanges ? "(적용)" : "(dry run)"}`,
  `항목: ${rows.length} -> ${afterTotal}  (제거 ${rows.length - afterTotal})`,
  `  1) ko 안의 "(id)" 괄호 제거 : ${parenStrippedCount}행`,
  `  2) id == ko 항목 제거        : ${identicalCount}행`,
  `  3) table 필드 제거           : 배열 파일 전체`,
  `  4) 키 중복 병합              : ${mergedKeys}키 / ${mergedRows}행 제거`,
  `  5) "[...]" 마크업 정리        : ${markupStrippedCount}행`,
  "",
  `[값이 갈린 키 ${conflicts.length}개 · 상위 30]`,
];
for (const conflict of conflicts.slice(0, 30)) {
  report.push(
    `  ${conflict.key} => ${conflict.kept} (${conflict.keptFile})  |  버림: ${conflict.droppedValues.join(" / ")} (${conflict.droppedFiles.join(", ")})`,
  );
}
report.push("", "[파일별 항목 수]");
for (const file of perFile) {
  report.push(
    `  ${file.fileName.padEnd(36)} ${String(file.before).padStart(6)} -> ${String(file.after).padStart(6)}  (${file.after - file.before})`,
  );
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "clean-report.txt"),
  `${report.join("\n")}\n`,
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "clean-report.json"),
  `${JSON.stringify(
    {
      totals: {
        entriesBefore: rows.length,
        entriesAfter: afterTotal,
        parenStripped: parenStrippedCount,
        identicalDropped: identicalCount,
        markupStripped: markupStrippedCount,
        mergedKeys,
        mergedRows,
        conflicts: conflicts.length,
      },
      perFile,
      conflicts,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(report.slice(0, 7).join("\n"));
console.log(`값이 갈린 키 ${conflicts.length}개 — data/poe_ninja_audit/clean-report.txt`);
console.log("[파일별 항목 수]");
for (const file of perFile) {
  if (file.before !== file.after) {
    console.log(
      `  ${file.fileName} ${file.before} -> ${file.after} (${file.after - file.before})`,
    );
  }
}

if (applyChanges) {
  await mkdir(backupDirectory, { recursive: true });
  for (const fileName of DATA_FILES) {
    const backupPath = path.join(backupDirectory, fileName);
    const exists = await access(backupPath).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await cp(path.join(translationDirectory, fileName), backupPath);
    }
  }
  for (const [fileName, payload] of newPayloads) {
    const trailingNewline = loads.get(fileName).trailingNewline;
    await writeFile(
      path.join(translationDirectory, fileName),
      `${JSON.stringify(payload, null, 2)}${trailingNewline ? "\n" : ""}`,
      "utf8",
    );
  }
  console.log("translations/ 재작성 완료 (백업: data/translations_backup_clean/)");
} else {
  console.log("dry run — 적용하려면: node scripts/clean_translations.mjs --apply");
}
