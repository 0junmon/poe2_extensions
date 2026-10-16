// 파이프라인 루트(= data/, translations/ 가 있는 폴더)를 찾는다.
//
// 우선순위
//   1) POBKR_ROOT 환경변수  (build-all.cmd 가 자기 폴더로 지정한다)
//   2) 스크립트 폴더에서 위로 올라가며 data/balance 가 있는 폴더
//   3) 스크립트 폴더의 상위 폴더 (기존 구조)
//
// 그래서 프로젝트 폴더를 통째로 옮기거나, build-all.cmd 를 다른 폴더에 두고 그 폴더를
// 기준으로 삼아도 동작한다.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DEPTH = 6;

export function findProjectRoot(startDirectory) {
  let directory = path.resolve(startDirectory);
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    if (existsSync(path.join(parent, "data", "balance"))) {
      return parent;
    }
    directory = parent;
  }
  return path.resolve(startDirectory, "..");
}

export function resolveProjectRoot(importMetaUrl) {
  const fromEnvironment = process.env.POBKR_ROOT;
  if (fromEnvironment) {
    return path.resolve(fromEnvironment);
  }
  return findProjectRoot(path.dirname(fileURLToPath(importMetaUrl)));
}
