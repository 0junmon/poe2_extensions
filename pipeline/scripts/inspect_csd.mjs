// Inspect GGPK-extracted StatDescription files.
//
//   node scripts/inspect_csd.mjs [folder ...]
//
// Defaults to data/ggpk-kr/Data/StatDescriptions and data/ggpk-en/Data/StatDescriptions.
// The report is format agnostic on purpose: it prints the block keywords, the
// language markers and the lines we are still missing, so the .csd grammar can be
// read off the real files.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);

const defaultFolders = [
  "data/statdescriptions",
  "data/ggpk-kr/Data/StatDescriptions",
  "data/ggpk-en/Data/StatDescriptions",
  "data/ggpk/Data/StatDescriptions",
];

const NEEDLES = [
  "both weapons hit",
  "Cannot cause Stun buildup",
  "Shockwave radius",
  "metres to Melee Strike Range",
  "more damage with Hits for Shockwaves",
  "cannot cause stun buildup",
  "감폭한 피해",
  "기절 축적",
  "충격파 반경",
  "근접 타격 범위",
];

const SAMPLE_FILE = "specific_skill_stat_descriptions/boneshatter.csd";

const folders = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultFolders).map(
  (entry) => path.resolve(projectRoot, entry),
);

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf8";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return "utf16le";
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return "utf16be";
  // No BOM: assume UTF-16LE when every other byte of the sample is NUL.
  const sample = Math.min(buffer.length, 8192);
  let oddZeros = 0;
  for (let index = 1; index < sample; index += 2) if (buffer[index] === 0) oddZeros += 1;
  if (oddZeros > sample / 4) return "utf16le";
  return "utf8";
}

function decode(buffer) {
  const encoding = detectEncoding(buffer);
  if (encoding === "utf16le") return { encoding, text: buffer.toString("utf16le").replace(/^\uFEFF/, "") };
  if (encoding === "utf16be") {
    const copy = Buffer.from(buffer);
    copy.swap16();
    return { encoding, text: copy.toString("utf16le").replace(/^\uFEFF/, "") };
  }
  return { encoding, text: buffer.toString("utf8").replace(/^\uFEFF/, "") };
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let inspectedAny = false;

for (const folder of folders) {
  console.log(`\n########## ${path.relative(projectRoot, folder) || folder} ##########`);
  if (!existsSync(folder)) {
    console.log("  (없음 — 아직 추출되지 않았습니다)");
    continue;
  }
  inspectedAny = true;

  const files = walk(folder);
  const csdFiles = files.filter((file) => file.toLowerCase().endsWith(".csd"));
  const totalBytes = csdFiles.reduce((sum, file) => sum + statSync(file).size, 0);
  console.log(`  .csd 파일 ${csdFiles.length}개, 합계 ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`  그 밖의 파일 ${files.length - csdFiles.length}개`);
  if (csdFiles.length === 0) {
    console.log("  !! .csd 파일이 없습니다. 폴더 구조를 확인해 주세요.");
    continue;
  }

  const languages = new Map();
  const encodings = new Map();
  const keywords = new Map();
  const found = new Map(NEEDLES.map((needle) => [needle, []]));
  const koreanLines = new Map();
  let sampleText = null;

  for (const file of csdFiles) {
    const { encoding, text } = decode(readFileSync(file));
    encodings.set(encoding, (encodings.get(encoding) ?? 0) + 1);
    const relative = path.relative(folder, file);
    if (relative.split(path.sep).join("/") === SAMPLE_FILE) sampleText = text;

    let koreanCount = 0;
    for (const line of text.split(/\r?\n/)) {
      const languageMatch = /^\s*lang\s+"?([A-Za-z][A-Za-z_-]*)"?/.exec(line);
      if (languageMatch) languages.set(languageMatch[1], (languages.get(languageMatch[1]) ?? 0) + 1);
      if (line.length > 0 && !/^\s/.test(line)) {
        const keyword = line.trim().split(/[\s"]/)[0];
        if (keyword.length > 0 && keyword.length < 40) {
          keywords.set(keyword, (keywords.get(keyword) ?? 0) + 1);
        }
      }
      if (/[가-힣]/.test(line)) {
        koreanCount += 1;
        koreanLines.set(relative, (koreanLines.get(relative) ?? 0) + 1);
      }
      for (const needle of NEEDLES) {
        if (line.includes(needle) && found.get(needle).length < 3) {
          found.get(needle).push(`${relative}: ${line.trim().slice(0, 150)}`);
        }
      }
    }
    if (koreanCount > 0 && !koreanLines.has(relative)) koreanLines.set(relative, koreanCount);
  }

  console.log(`  인코딩: ${[...encodings].map(([key, count]) => `${key}=${count}`).join(", ")}`);
  console.log(
    `  lang 마커: ${languages.size === 0 ? "없음" : [...languages.entries()].map(([key, count]) => `${key}(${count})`).join(", ")}`,
  );
  console.log(`  한글이 들어 있는 파일: ${koreanLines.size}개, 전체 ${csdFiles.length}개`);
  console.log(
    `  블록 키워드(상위 12): ${[...keywords.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([key, count]) => `${key}=${count}`)
      .join(", ")}`,
  );

  console.log("\n  --- 찾는 문구 ---");
  for (const [needle, hits] of found) {
    console.log(`  ${hits.length > 0 ? "O" : "X"} ${needle}`);
    for (const hit of hits.slice(0, 3)) console.log(`      ${hit}`);
  }

  if (sampleText) {
    console.log(`\n  --- ${SAMPLE_FILE} (앞 70줄) ---`);
    for (const line of sampleText.split(/\r?\n/).slice(0, 70)) console.log(`  | ${line}`);
  } else {
    console.log(`\n  !! ${SAMPLE_FILE} 를 찾지 못했습니다.`);
  }
}

if (!inspectedAny) {
  console.log(
    "\n추출된 폴더가 없습니다. GGPK_EXTRACTION_REQUEST.md 의 경로로 내보낸 뒤 다시 실행하세요.",
  );
}
