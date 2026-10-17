// 파이프라인이 읽는 "코드 파일"(확장/유저스크립트/도구)의 위치를 찾는다.
//
// 같은 스크립트가 두 가지 배치에서 모두 동작해야 한다.
//
//   데이터 폴더(poe2_translation) : <root>/scripts/…        + ../chrome-extension, ../userscripts
//   코드 저장소(poe2_extensions)     : <ext>/pipeline/scripts/… + ../../sites/ninja, ../../core, ../../tools
//
// 기준 폴더(데이터)는 project-root.mjs 가 TRANSLATION_ROOT 로 찾고, 코드 파일은 이 파일이 스크립트
// 폴더 기준 후보 경로를 순서대로 확인해 처음 존재하는 것을 쓴다.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DEPTH = 6;
// 배치를 구분하는 표식 폴더: 데이터 폴더에는 chrome-extension, 모노레포에는 sites 가 있다.
const CODE_FOLDER_NAMES = ["chrome-extension", "sites"];

// 스크립트 폴더에서 위로 올라가며 코드 폴더가 있는 폴더(= 코드 루트)를 찾는다.
// dist/ 나 data-search-data.js 처럼 결과물을 둘 위치를 정할 때 쓴다.
export function findCodeRoot(importMetaUrl) {
  const scriptDirectory = path.dirname(fileURLToPath(importMetaUrl));
  let directory = scriptDirectory;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (CODE_FOLDER_NAMES.some((name) => existsSync(path.join(directory, name)))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return path.resolve(scriptDirectory, "..");
}

// 후보 경로(스크립트 폴더 기준) 중 처음 존재하는 파일을 돌려준다.
export function resolveSourceFile(importMetaUrl, ...candidates) {
  const scriptDirectory = path.dirname(fileURLToPath(importMetaUrl));
  for (const candidate of candidates) {
    const resolved = path.resolve(scriptDirectory, candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(`코드 파일을 찾을 수 없습니다: ${candidates.join(" | ")}`);
}
