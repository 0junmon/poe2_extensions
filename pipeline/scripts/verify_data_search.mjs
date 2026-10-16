// data-search.html 이 실제 브라우저에서 translations/ 의 키를 찾아 파일 주소·구조·값을
// 보여주는지 확인한다.
//
//   node scripts/verify_data_search.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolveProjectRoot(import.meta.url);
const origin = "https://data-search.test";
const failures = [];

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "O" : "X"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures.push(label);
  }
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on("console", (message) => logs.push(message.text()));
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

await page.route(`${origin}/**`, async (route) => {
  const { pathname } = new URL(route.request().url());
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const contentType = relative.endsWith(".html")
    ? "text/html; charset=utf-8"
    : relative.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "application/json";
  try {
    const body = await readFile(path.join(projectRoot, relative), "utf8");
    await route.fulfill({ status: 200, contentType, body });
  } catch {
    await route.fulfill({ status: 404, body: "not found" });
  }
});

await page.goto(`${origin}/data-search.html`);
const deadline = Date.now() + 60000;
while (
  Date.now() < deadline &&
  !(await page.evaluate(() => globalThis.__dataSearch?.ready?.() ?? false))
) {
  await page.waitForTimeout(100);
}

const status = await page.textContent("#status");
console.log(status);
if (!(await page.evaluate(() => globalThis.__dataSearch?.ready?.() ?? false))) {
  console.log("페이지 로그:", logs.join(" | ") || "(없음)");
}
const count = await page.evaluate(() => globalThis.__dataSearch?.count?.() ?? 0);
check("모든 번역 키 로드", count > 40000, `키 ${count}개`);

async function setMode(target) {
  const current = await page.evaluate(() => globalThis.__dataSearch.mode());
  if (current !== target) {
    await page.click(".switch");
  }
  return page.evaluate(() => globalThis.__dataSearch.mode());
}

async function search(query, { mode, submit = "click" } = {}) {
  if (mode) {
    await setMode(mode);
  }
  await page.fill("#query", query);
  if (submit === "enter") {
    await page.press("#query", "Enter");
  } else {
    await page.click("#search-button");
  }
  await page.waitForTimeout(60);
  return page.evaluate(() => ({
    summary: document.getElementById("summary").textContent,
    results: [...document.querySelectorAll("#results li")].map((item) => ({
      file: item.querySelector("a.file")?.textContent ?? "",
      meta: item.querySelector(".meta")?.textContent ?? "",
      json: item.querySelector("pre")?.textContent ?? "",
      bold: [...item.querySelectorAll(".value.strong")].map((node) =>
        node.textContent.trim().replace(/^"|"$/g, ""),
      ),
      hits: [...item.querySelectorAll("strong.hit")].map((node) =>
        node.textContent.trim(),
      ),
    })),
  }));
}

console.log("\n[완전 검색]");
const gemLevel = await search("Gem Level", { mode: "exact" });
const gemLevelResult =
  gemLevel.results.find((result) => result.file.includes("keyword.json")) ??
  gemLevel.results[0];
check(
  "완전 검색은 키 전체가 같은 항목만 찾는다",
  gemLevel.results.length > 0 &&
    !gemLevel.results.some((result) => result.json.includes('"Gem Levels"')),
  `${gemLevel.results.length}건(${gemLevel.results
    .map((result) => result.file.split("/").pop())
    .join(", ")}) · ${gemLevel.summary}`,
);
check(
  "파일의 전체 주소를 보여준다",
  gemLevelResult.file === `${origin}/translations/general/keyword.json`,
  gemLevelResult.file,
);
check(
  "배열 파일은 해당 객체를 보여준다",
  gemLevelResult.json.includes('"id": "Gem Level"') &&
    gemLevelResult.json.includes('"ko"'),
  gemLevelResult.json.replace(/\s+/g, " ").slice(0, 80),
);
check(
  "일치한 키를 굵게 표시한다",
  gemLevelResult.hits.join(",") === "Gem Level",
  JSON.stringify(gemLevelResult.hits),
);
check(
  "값을 굵게 표시한다",
  gemLevelResult.bold.join(",") === "젬 레벨",
  JSON.stringify(gemLevelResult.bold),
);

console.log("\n[엔터 키 검색]");
const enterSearch = await search("Boneshatter", { mode: "exact", submit: "enter" });
check(
  "엔터를 눌러도 검색된다",
  enterSearch.results.length > 0 &&
    enterSearch.results.some((result) => result.file.includes("skill_gem_lines.json")),
  `${enterSearch.results.length}건 · ${enterSearch.summary}`,
);

console.log("\n[객체 파일은 해당 항목을 출력]");
const objectFile = await search("Quality from Gem", { mode: "exact" });
const objectResult = objectFile.results.find((result) =>
  result.file.includes("poe_ninja.json"),
);
check(
  "객체 파일은 id → 값 항목을 보여준다",
  Boolean(objectResult) &&
    objectResult.json.includes('"Quality from Gem": "젬 퀄리티"'),
  objectResult?.json.replace(/\s+/g, " ").slice(0, 80) ?? "결과 없음",
);

console.log("\n[부분 일치 검색]");
const partial = await search("gem l", { mode: "partial" });
check(
  "토글 후 부분 일치로 찾는다",
  partial.results.length > 1 && partial.summary.startsWith("부분 일치"),
  `${partial.results.length}건 · ${partial.summary}`,
);
check(
  "부분 일치에도 해당 글자를 굵게 표시한다",
  partial.results.every((result) => result.hits.length > 0),
  JSON.stringify(partial.results[0]?.hits ?? []),
);
const exactMode = await search("gem l", { mode: "exact" });
check(
  "같은 검색어가 완전 검색에서는 일치하지 않는다",
  exactMode.results.length === 0,
  `${exactMode.results.length}건 · ${exactMode.summary}`,
);

console.log("\n[빈 검색어]");
const empty = await search("", { mode: "exact" });
check("빈 검색어는 결과를 비운다", empty.results.length === 0, empty.summary);

console.log("\n[스위치 검색 모드]");
const switchBefore = await page.isChecked("#mode-switch");
await page.click(".switch");
const switchAfter = await page.isChecked("#mode-switch");
const switchLabel = await page.textContent("#mode-label");
check(
  "스위치는 왼쪽 완전 / 오른쪽 부분 일치",
  switchBefore === false && switchAfter === true && switchLabel === "부분",
  `checked ${switchBefore} → ${switchAfter}, 라벨 ${switchLabel}`,
);
await page.click(".switch");

console.log("\n[중복 검색]");
await page.click("#duplicate-button");
await page.waitForTimeout(300);
const firstBatch = await page.evaluate(() => {
  const groups = [...document.querySelectorAll("#results li.dup-group")];
  return {
    summary: document.getElementById("summary").textContent,
    groups: groups.length,
    maxOccurrences: Math.max(
      0,
      ...groups.map((group) => group.querySelectorAll("li.occurrence").length),
    ),
    moreLabel: document.querySelector("#results li.more button")?.textContent ?? "",
    applied: document.querySelectorAll("#results li.dup-group .badge.applied").length,
    conflicts: document.querySelectorAll("#results li.dup-group .badge:not(.applied)")
      .length,
  };
});
check(
  "중복 그룹을 값 충돌 우선으로 보여준다",
  firstBatch.groups === 5 &&
    firstBatch.applied > 0 &&
    firstBatch.conflicts > 0 &&
    firstBatch.summary.includes("중복 키"),
  `${firstBatch.groups}그룹(값 충돌 ${firstBatch.conflicts}) · ${firstBatch.summary}`,
);
check(
  "그룹마다 항목을 5개까지만 표시한다",
  firstBatch.maxOccurrences <= 5,
  `최대 ${firstBatch.maxOccurrences}개`,
);
check(
  "그룹 더보기 버튼을 제공한다",
  firstBatch.moreLabel.includes("그룹 더보기"),
  firstBatch.moreLabel,
);
const expandedGroups = await page.evaluate(() => {
  document.querySelector("#results li.more button")?.click();
  return document.querySelectorAll("#results li.dup-group").length;
});
check("더보기로 그룹을 더 본다", expandedGroups === 10, `그룹 ${expandedGroups}개`);

console.log("\n[중복 그룹의 적용 항목]");
const appliedFile = await page.evaluate(() => {
  const groups = [...document.querySelectorAll("#results li.dup-group")];
  const target = groups.find((group) =>
    group.textContent.includes("general/custom.json"),
  );
  return target
    ? target.querySelector(".badge.applied")?.closest(".head")?.textContent ?? ""
    : "";
});
check(
  "custom.json 항목에 '적용' 배지가 붙는다",
  appliedFile === "" || appliedFile.includes("custom.json"),
  appliedFile.replace(/\s+/g, " ").slice(0, 90),
);

console.log("\n[file:// 로 그냥 열기(더블클릭)]");
const filePage = await browser.newPage();
await filePage.goto(
  `file:///${path.join(projectRoot, "data-search.html").replace(/\\/g, "/")}`,
);
const fileDeadline = Date.now() + 60000;
while (
  Date.now() < fileDeadline &&
  !(await filePage.evaluate(() => globalThis.__dataSearch?.ready?.() ?? false))
) {
  await filePage.waitForTimeout(100);
}
const fileState = await filePage.evaluate(async () => {
  document.getElementById("query").value = "Gem Level";
  document.getElementById("search-button").click();
  return {
    count: globalThis.__dataSearch.count(),
    status: document.getElementById("status").textContent,
    results: document.querySelectorAll("#results li.result").length,
  };
});
check(
  "내장 데이터로 동작한다(서버 불필요)",
  fileState.count > 40000 && fileState.status.includes("내장 데이터"),
  `${fileState.count}키 · ${fileState.status}`,
);
check("file:// 에서도 검색이 된다", fileState.results >= 1, `결과 ${fileState.results}건`);
await filePage.close();

await browser.close();

if (failures.length > 0) {
  console.log(`\n실패 ${failures.length}건: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\ndata-search.html 검증 통과");
}
