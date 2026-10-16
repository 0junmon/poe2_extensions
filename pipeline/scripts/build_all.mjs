// Runs the whole translation data pipeline in one go.
//
//   node scripts/build_all.mjs          (or double-click build-all.cmd in the project root)
//   npm run build:all
//
// All paths are resolved from this file, so a copy of the project folder runs as it is.
//
// The order matters:
//   - python build_translation_map.py writes items/base_items.json and
//     items/item_class_singulars.json, which build:unique-items and build:skill-lines read.
//   - scripts/clean_translations.mjs rewrites every file, so it is always the last data step.
//   - the extension/bundle builds copy the cleaned data, so they come after that.
//
// Every step is executed even when one fails; the summary at the end lists what failed and
// the last lines of that step's output. Exit code is 1 when any step failed.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "./project-root.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

// 기준 폴더(base) 우선순위: --root 인자 > POBKR_ROOT 환경변수 > 스크립트 위치에서 자동 탐색.
// build-all.cmd 가 자기 폴더를 POBKR_ROOT 로 넘기므로, cmd 가 있는 폴더가 기준이 된다.
const rootArgumentIndex = process.argv.indexOf("--root");
const rootArgument =
  rootArgumentIndex >= 0 ? process.argv[rootArgumentIndex + 1] : undefined;
const projectRoot = path.resolve(
  rootArgument ?? process.env.POBKR_ROOT ?? findProjectRoot(scriptDirectory),
);
console.log(`기준 폴더: ${projectRoot}`);

// Hand maintained inputs; the pipeline only regenerates what is derived from them.
const REQUIRED_FILES = [
  "translations/general/custom.json",
  "translations/general/keyword.json",
  "translations/general/poe_ninja.json",
  "data/balance/itemclasses.json",
  "data/balance/ascendancy.json",
  "data/balance/korean/ascendancy.json",
  "data/statdescriptions",
];
const OUTPUT_DIRECTORIES = [
  "translations/general",
  "translations/names",
  "translations/items",
  "translations/lines",
];

const nodeCommand = process.execPath;
const pythonCommand = process.platform === "win32" ? "python" : "python3";
const script = (fileName) => path.join(scriptDirectory, fileName);
const translationMap = existsSync(script("build_translation_map.py"))
  ? script("build_translation_map.py")
  : path.join(projectRoot, "build_translation_map.py");

const STEPS = [
  { name: "번역 맵 (GGPK 덤프)", command: pythonCommand, args: [translationMap] },
  { name: "유니크 아이템 (거래소 API)", command: nodeCommand, args: [script("build_unique_items.mjs")] },
  { name: "거래소 스탯 라인 (거래소 API)", command: nodeCommand, args: [script("build_trade_stats.mjs")] },
  { name: "스킬 젬 라인", command: nodeCommand, args: [script("build_skill_lines.mjs")] },
  { name: "스탯 설명 라인 (.csd)", command: nodeCommand, args: [script("build_csd_lines.mjs")] },
  { name: "고유 설명문", command: nodeCommand, args: [script("build_flavour_text.mjs")] },
  { name: "키워드 설명", command: nodeCommand, args: [script("build_keyword_definitions.mjs")] },
  { name: "지역/퀘스트 이름", command: nodeCommand, args: [script("build_game_names.mjs")] },
  { name: "캐릭터/전직 이름", command: nodeCommand, args: [script("build_character_classes.mjs")] },
  { name: "데이터 정리 (마지막)", command: nodeCommand, args: [script("clean_translations.mjs"), "--apply"] },
  { name: "검색 번들", command: nodeCommand, args: [script("build_data_search_bundle.mjs")] },
  { name: "크롬 확장", command: nodeCommand, args: [script("build_chrome_extension.mjs")] },
];

// 새 폴더에서 general/ 을 바닥에 두고 오는 경우를 처리한다: translations/ 를 만들고 그 안으로 옮긴다.
const rootGeneral = path.join(projectRoot, "general");
const translationsGeneral = path.join(projectRoot, "translations", "general");
if (existsSync(rootGeneral)) {
  if (existsSync(translationsGeneral)) {
    console.log(`general/ 이 translations/general/ 에도 있어 그대로 둡니다: ${rootGeneral}`);
  } else {
    mkdirSync(path.dirname(translationsGeneral), { recursive: true });
    try {
      renameSync(rootGeneral, translationsGeneral);
    } catch {
      cpSync(rootGeneral, translationsGeneral, { recursive: true });
      rmSync(rootGeneral, { recursive: true, force: true });
    }
    console.log(`general/ 을 translations/general/ 로 옮겼습니다: ${translationsGeneral}`);
  }
}

const missing = REQUIRED_FILES.filter((file) => !existsSync(path.join(projectRoot, file)));
if (missing.length > 0) {
  console.error("입력이 없어 실행할 수 없습니다:");
  for (const file of missing) console.error(`  ${file}`);
  console.error("(일반/키워드/커스텀 파일과 GGPK 덤프가 프로젝트 폴더에 있어야 합니다)");
  process.exit(1);
}
for (const directory of OUTPUT_DIRECTORIES) {
  mkdirSync(path.join(projectRoot, directory), { recursive: true });
}

const results = [];
const total = STEPS.length;
STEPS.forEach((step, index) => {
  const label = `[${String(index + 1).padStart(2)}/${total}] ${step.name}`;
  console.log(`\n${label} — ${step.command} ${step.args.join(" ")}`);
  if (dryRun) {
    console.log("  (dry run — 실행하지 않음)");
    results.push({ step, ok: true, seconds: "0.0", lines: [] });
    return;
  }
  const started = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: projectRoot,
    // shell 없이 실행한다: 실행 파일 경로에 공백이 있어도(node.exe) 그대로 전달되도록.
    encoding: "utf8",
    env: { ...process.env, POBKR_ROOT: projectRoot },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const ok = result.status === 0;
  if (ok) {
    const last = lines.length > 0 ? lines[lines.length - 1].trim() : "(출력 없음)";
    console.log(`  OK   ${seconds}s — ${last}`);
  } else {
    console.log(`  FAIL (exit ${result.status ?? "?"}) ${seconds}s`);
    if (result.error) console.log(`      실행 실패: ${result.error.message}`);
    for (const line of lines.slice(-15)) console.log(`      ${line}`);
  }
  results.push({ step, ok, seconds, lines });
});

const failed = results.filter((result) => !result.ok);
console.log("\n=== 요약 ===");
for (const result of results) {
  console.log(`  ${result.ok ? "OK  " : "FAIL"}  ${result.seconds.padStart(7)}s  ${result.step.name}`);
}
if (failed.length > 0) {
  console.log(`\n실패 ${failed.length}개: ${failed.map((result) => result.step.name).join(", ")}`);
  console.log("실패한 단계의 출력은 위에 있습니다(자동 디버깅은 하지 않습니다).");
}
process.exitCode = failed.length > 0 ? 1 : 0;
