// Local-only check for the official trade API stat texts.
//
// Loads `userscripts/poe-ninja-translation.user.js` into Chromium with the real
// translation files, renders poe.ninja-like attribute lines (both as a single
// text node and split into <span>s, which is how poe.ninja draws a line when it
// contains keyword tooltips) and verifies the Korean result plus the 한/영 toggle.
//
//   node scripts/verify_trade_stats.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const contentScript = await readFile(
  path.join(projectRoot, "userscripts", "poe-ninja-translation.user.js"),
  "utf8",
);
const rows = JSON.parse(
  await readFile(path.join(translationDirectory, "lines/item_mod_lines.json"), "utf8"),
);

const sampleValues = ["+35", "12", "7", "3"];
const substitute = (template, values) => {
  let index = 0;
  return template.replace(/#/g, () => values[index++] ?? "0");
};
const koreanOf = (template) => {
  const row = rows.find((entry) => entry.id === template);
  if (!row) {
    throw new Error(`trade_stats.json 에 "${template}" 가 없습니다`);
  }
  return substitute(row.ko, sampleValues.slice(0, (template.match(/#/g) ?? []).length));
};

// The first template is picked from the data: a value-free text ("Cannot be Frozen").
const templates = [
  rows.find((row) => !row.id.includes("#") && row.id.length <= 30).id,
  "# to maximum Life",
  "#% increased Physical Damage",
  "Adds # to # Physical Damage",
  "Adds # to # Lightning damage to Attacks",
];
const splitParts = (text, groups = 2) => {
  const words = text.split(" ");
  if (words.length < groups) {
    return null;
  }
  const size = Math.ceil(words.length / groups);
  return Array.from({ length: groups }, (_, index) =>
    words.slice(index * size, (index + 1) * size).join(" "),
  );
};
const lines = [];
for (const [index, template] of templates.entries()) {
  const english = substitute(template, sampleValues);
  const korean = koreanOf(template);
  lines.push({ id: `case-${index}-single`, english, korean, html: english });
  const parts = splitParts(english);
  if (parts) {
    lines.push({
      id: `case-${index}-split`,
      english,
      korean,
      html: `<span>${parts[0]} </span><span class="keyword">${parts[1]}</span>`,
    });
  }
  // poe.ninja wraps keyword spans inside a tooltip wrapper span.
  const nested = splitParts(english, 3);
  if (nested) {
    lines.push({
      id: `case-${index}-nested`,
      english,
      korean,
      html:
        `<span>${nested[0]} </span><span class="keyword"><span>${nested[1]}</span></span>` +
        `<span> ${nested[2]}</span>`,
    });
  }
}

const noiseLines = Array.from(
  { length: 300 },
  (_, index) => `<div class="line">Synthetic Attribute ${index} of Testing</div>`,
).join("\n      ");

const pageHtml = `<!doctype html>
<html lang="en">
  <body>
    <div class="item">
      ${lines
        .map((line) => `<div class="line" data-case="${line.id}">${line.html}</div>`)
        .join("\n      ")}
      ${noiseLines}
    </div>
  </body>
</html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on("console", (message) => logs.push(message.text()));

await page.route("https://poe.ninja/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: pageHtml,
  }),
);
await page.route("https://extension.test/**", async (route) => {
  const fileName = new URL(route.request().url()).pathname.replace(/^\/+/, "");
  const body = await readFile(path.join(projectRoot, fileName), "utf8");
  await route.fulfill({ status: 200, contentType: "application/json", body });
});
await page.addInitScript(() => {
  window.chrome = {
    runtime: { getURL: (resource) => `https://extension.test/${resource}` },
  };
});

await page.goto("https://poe.ninja/poe2/builds/verify/character/test");
const loadStartedAt = Date.now();
await page.addScriptTag({ content: contentScript });

const deadline = Date.now() + 30000;
let loadMs;
while (Date.now() < deadline) {
  if (logs.some((text) => text.includes("번역 및 검색 데이터 로드 완료"))) {
    loadMs = Date.now() - loadStartedAt;
    break;
  }
  await page.waitForTimeout(10);
}
  const loadLog = logs.find((text) => text.includes("속성번역수"));
if (!loadLog) {
    throw new Error(`번역 데이터가 로드되지 않았습니다: ${JSON.stringify(logs)}`);
}

const readLines = () =>
  page.$$eval(".line", (elements) =>
    elements.map((element) => ({
      id: element.dataset.case,
      text: element.textContent.replace(/\s+/g, " ").trim(),
      spans: [...element.children].map((child) => child.textContent),
    })),
  );

const failures = [];
const assertKorean = (rendered, label) => {
  for (const line of lines) {
    const actual = rendered.find((entry) => entry.id === line.id);
    if (!actual) {
    failures.push(`${label} ${line.id}: 요소를 찾지 못했습니다`);
    } else if (actual.text !== line.korean) {
      failures.push(
      `${label} ${line.id}: "${line.english}" -> "${actual.text}" (기대: "${line.korean}")`,
      );
    }
  }
};

const afterKorean = (await readLines()).filter((entry) => entry.id);
  assertKorean(afterKorean, "영문");

await page.evaluate(() => {
  const host = document.getElementById("poe-ninja-korean-ui");
  const button = [...host.shadowRoot.querySelectorAll("button")].find(
    (element) => element.textContent === "한",
  );
  if (!button) {
    throw new Error("한/영 토글 버튼을 찾지 못했습니다");
  }
  button.click();
});
await page.waitForTimeout(200);

const afterEnglish = (await readLines()).filter((entry) => entry.id);
for (const line of lines) {
  const actual = afterEnglish.find((entry) => entry.id === line.id);
  if (actual && actual.text !== line.english) {
    failures.push(
      `영문 복원 ${line.id}: "${actual.text}" (기대: "${line.english}")`,
    );
  }
}

// Switch back to Korean and time a full document pass (300 noise lines included).
const reEnableStartedAt = Date.now();
await page.evaluate(() => {
  const host = document.getElementById("poe-ninja-korean-ui");
  const button = [...host.shadowRoot.querySelectorAll("button")].find(
    (element) => element.textContent === "영",
  );
  if (!button) {
    throw new Error("한/영 토글 버튼을 찾지 못했습니다");
  }
  button.click();
});
await page.evaluate(
  () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
);
const reEnableMs = Date.now() - reEnableStartedAt;
  assertKorean((await readLines()).filter((entry) => entry.id), "영문 전체");

console.log(loadLog);
console.log(
      `데이터 로드+첫번역 ${loadMs}ms / 전체 라인 ${reEnableMs}ms (라인 ${lines.length + 300}개)`,
);
  console.log("\n[한글 렌더링]");
for (const line of afterKorean) {
  const source = lines.find((entry) => entry.id === line.id);
  console.log(`  ${line.id}: "${source.english}" -> "${line.text}"`);
  if (line.spans.length > 1) {
    console.log(`      spans: ${JSON.stringify(line.spans)}`);
  }
}
  console.log("\n[영문 복원]");
for (const line of afterEnglish) {
  console.log(`  ${line.id}: "${line.text}"`);
}

await browser.close();

if (failures.length > 0) {
    console.error("\n실패:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`\n성공: ${lines.length}개 라인 번역 + 한/영 토글 복원 확인`);
}
