// data-search.html 을 로컬 서버 없이(file://) 열어도 되도록 번역 데이터를 한 파일로 묶는다.
// 파일이 크므로(전체 약 9MB) 필요할 때만 다시 실행하면 된다.
//
//   node scripts/build_data_search_bundle.mjs      (npm run build:data-search)
//
// 결과: data-search-data.js (data-search.html 이 file:// 에서 fetch 대신 사용)

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import "../data-search-files.js";

const projectRoot = resolveProjectRoot(import.meta.url);
const outputPath = path.join(projectRoot, "data-search-data.js");
const files = globalThis.DATA_SEARCH_FILES ?? [];
const payloads = {};
let totalBytes = 0;

for (const fileName of files) {
  const filePath = path.join(projectRoot, "translations", fileName);
  try {
    const text = await readFile(filePath, "utf8");
    payloads[fileName] = JSON.parse(text.replace(/^\uFEFF/, ""));
    totalBytes += (await stat(filePath)).size;
  } catch (error) {
    // 아직 없는 파일(빈 custom.json 등)은 건너뛴다.
    console.warn(`${fileName} 건너뜀: ${error.message}`);
  }
}

const builtAt = new Date().toISOString();
const output =
  "// 생성 파일 — 직접 고치지 마세요. npm run build:data-search 로 다시 만듭니다.\n" +
  "// data-search.html 이 file:// 로 열렸을 때 fetch 대신 쓰는 내장 데이터입니다.\n" +
  `globalThis.DATA_SEARCH_BUNDLE = { builtAt: ${JSON.stringify(builtAt)} };\n` +
  `globalThis.DATA_SEARCH_PAYLOADS = ${JSON.stringify(payloads)};\n`;

await writeFile(outputPath, output, "utf8");
console.log(
  `data-search-data.js 생성 완료 — 파일 ${Object.keys(payloads).length}개, ` +
    `JSON ${(totalBytes / 1024 / 1024).toFixed(1)}MB, ${builtAt}`,
);
