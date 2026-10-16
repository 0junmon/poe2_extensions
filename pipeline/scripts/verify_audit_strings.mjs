// Runs every string that poe.ninja rendered without a translation (the audit output)
// through the content script and prints what is still English.
//
//   node scripts/verify_audit_strings.mjs
//
// The audit file is produced outside of this script: it lists the English text nodes
// that the extension did not translate on poe.ninja character pages.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const auditDirectory = path.join(projectRoot, "data", "poe_ninja_audit");
const contentScript = readFileSync(
  path.join(projectRoot, "userscripts", "poe-ninja-translation.user.js"),
  "utf8",
);

const auditFile = path.join(auditDirectory, "unmatched-strings.json");
if (!existsSync(auditFile)) {
  throw new Error(`감사 데이터가 없습니다: ${auditFile}`);
}
const entries = JSON.parse(readFileSync(auditFile, "utf8"))
  .map((entry) => (typeof entry === "string" ? { value: entry, pageCount: 0 } : entry))
  .filter(
    (entry) =>
      typeof entry.value === "string" &&
      entry.value.trim().length >= 2 &&
      // Numbers, percentages and separators never need a translation.
      !/^[\d\s.,%+\-/·()]+$/.test(entry.value) &&
      /[A-Za-z가-힣]/.test(entry.value),
  );

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on("console", (message) => logs.push(message.text()));
await page.route("https://poe.ninja/**", (route) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<html></html>" }),
);
await page.route("https://extension.test/**", async (route) => {
  const fileName = new URL(route.request().url()).pathname.replace(/^\/+/, "");
  const body = await readFile(path.join(projectRoot, fileName), "utf8");
  await route.fulfill({ status: 200, contentType: "application/json", body });
});
await page.addInitScript(() => {
  window.chrome = { runtime: { getURL: (resource) => `https://extension.test/${resource}` } };
});
await page.goto("https://poe.ninja/poe2/builds/verify/character/test");
await page.addScriptTag({ content: contentScript });

const deadline = Date.now() + 30000;
while (Date.now() < deadline && !logs.some((text) => text.includes("속성번역수"))) {
  await page.waitForTimeout(50);
}
console.log(logs.find((text) => text.includes("속성번역수")) ?? "(로드 실패)");

const results = await page.evaluate((values) => {
  const api = globalThis.__poeNinjaKoreanTranslation;
  return values.map((value) => api.translate(value) ?? null);
}, entries.map((entry) => entry.value));

let translated = 0;
const remaining = [];
entries.forEach((entry, index) => {
  if (results[index]) {
    translated += 1;
  } else {
    remaining.push(entry);
  }
});
remaining.sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0));

console.log(`\n감사 문자열 ${entries.length}개 중 번역됨 ${translated}개 (남음 ${remaining.length}개)`);
console.log("\n[남은 문자열 상위 40]");
for (const entry of remaining.slice(0, 40)) {
  console.log(`  ${String(entry.pageCount ?? 0).padStart(3)}  ${entry.value.slice(0, 100)}`);
}
const listed = readdirSync(translationDirectory, { recursive: true }).filter((name) =>
  String(name).endsWith(".json"),
);
console.log(`\n데이터 파일 ${listed.length}개: ${listed.join(", ")}`);
await browser.close();
