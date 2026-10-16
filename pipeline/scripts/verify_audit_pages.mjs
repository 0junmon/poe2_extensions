// Loads the saved poe.ninja pages of the audit with the content script injected and
// lists the English text nodes that are still untranslated.
//
//   node scripts/verify_audit_pages.mjs
//
// This is end to end, including the span joining the content script does on a real
// page, unlike `verify:audit-strings` which asks the lookup for single audit strings
// (a line is split into fragments there, so fragments are expected to stay English).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const pagesDirectory = path.join(projectRoot, "data", "poe_ninja_audit", "pages");
const contentScript = readFileSync(
  path.join(projectRoot, "userscripts", "poe-ninja-translation.user.js"),
  "utf8",
);

if (!existsSync(pagesDirectory)) {
  throw new Error(`감사 페이지가 없습니다: ${pagesDirectory}`);
}
const pageFiles = readdirSync(pagesDirectory)
  .filter((name) => name.endsWith(".html"))
  .slice(0, 6);

const browser = await chromium.launch({ headless: true });
const remaining = new Map();
const logs = [];
let translatedNodes = 0;

for (const file of pageFiles) {
  const html = readFileSync(path.join(pagesDirectory, file), "utf8");
  const page = await browser.newPage();
  page.on("console", (message) => logs.push(message.text()));
  await page.route("https://poe.ninja/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.route("https://extension.test/**", async (route) => {
    const fileName = new URL(route.request().url()).pathname.replace(/^\/+/, "");
    const body = await readFile(path.join(projectRoot, fileName), "utf8");
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.addInitScript(() => {
    window.chrome = { runtime: { getURL: (resource) => `https://extension.test/${resource}` } };
  });
  await page.goto("https://poe.ninja/poe2/builds/verify/character/audit");
  await page.addScriptTag({ content: contentScript });

  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready = await page.evaluate(
      () => globalThis.__poeNinjaKoreanTranslation?.ready?.() ?? false,
    );
    if (!ready) await page.waitForTimeout(100);
  }
  // The content script translates in animation frames, so give it a few of them.
  for (let index = 0; index < 20; index += 1) await page.waitForTimeout(50);

  const snapshot = await page.evaluate(() => {
    const english = [];
    let korean = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (!value || value.length < 2) continue;
      if (!node.parentElement) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement.tagName)) continue;
      if (/[가-힣]/.test(value)) {
        korean += 1;
        continue;
      }
      if (!/[A-Za-z]/.test(value)) continue;
      english.push(value);
    }
    return { english, korean };
  });
  translatedNodes += snapshot.korean;
  for (const text of snapshot.english) remaining.set(text, (remaining.get(text) ?? 0) + 1);
  await page.close();
}

console.log(logs.find((text) => text.includes("속성번역수")) ?? "(로드 로그 없음)");
console.log(
  `\n감사 페이지 ${pageFiles.length}개: 한글로 바뀐 텍스트 노드 ${translatedNodes}개, ` +
    `남은 영문 ${remaining.size}종,`
);

const sorted = [...remaining.entries()].sort((a, b) => b[1] - a[1]);
console.log("\n[남은 영문 상위 40 — 사이트 UI 문자열은 게임 데이터가 아닙니다]");
for (const [text, count] of sorted.slice(0, 40)) {
  console.log(`  ${String(count).padStart(2)}  ${text.slice(0, 110)}`);
}
await browser.close();
