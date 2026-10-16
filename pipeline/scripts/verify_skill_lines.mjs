// Local-only check: renders the Boneshatter tooltip lines in Chromium with the
// content script and prints which lines the translation data covers.
//
//   node scripts/verify_skill_lines.mjs

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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

// The tooltip as Path of Exile 2 shows it (values in parentheses are the range
// over all gem levels; both forms are checked).
const LINES = [
  "Boneshatter",
  "Attack",
  "AoE, Melee, Strike",
  "Tier: 1",
  "Level: (1—20)",
  "Level: 20",
  "Cost: (9—60) Mana",
  "Cost: 60 Mana",
  "Attack Speed: 60% of base",
  "Attack Damage: (100—312)% of base",
  "Attack Damage: 312% of base",
  "Requires: Level (1—90), (4—157) Str",
  "Requires: One Hand Maces, Two Hand Maces",
  "Attack enemies with a melee Strike. The Strike will cause a Heavy Stun on enemies that are Primed for Stun. Upon causing a Heavy Stun it will also create a Shockwave, dealing a large amount of damage in an area.",
  "Initial Strike",
  "+0.2 metres to Melee Strike Range",
  "While Dual Wielding, both weapons hit with 30% less damage",
  "Cannot cause Stun buildup",
  "Additional Effects From Quality:",
  "(0—20)% increased Attack Speed",
  "Shockwave radius is (0—2) metres",
  "Shockwave radius is 2 metres",
  "Shockwave",
  "Attack Damage: (200—724)%",
  "50% more damage with Hits for Shockwaves originating from a Unique enemy",
  "Skills can be managed in the Skills Panel.",
  "Gem Quality grants Socketed Skills an additional effect",
  "Sorcery Ward's Barrier can also take Physical and Chaos Damage from Hits",
  "Valley of the Titans",
  "Halls of the Dead - Ngamahu's Test",
  "Category",
  "Category:",
  "Support Gem Requirements",
  "Support Gem Requirements:",
  "Support Requirements:",
  "Nova Projectiles",
  "Nova Projectiles II",
  "Quality (Fire Modifiers)",
  "Item Level",
  "Lasts 3 Seconds",
  "Consumes 20 of 40 Charges on use",
  "Currently has 40 Charges",
  "Recovers 1793 Life over 3 Seconds",
  "Recovers 60 Mana every 2 Seconds",
  "Quality from Gem",
  "Debuffs are negative effects that deal damage or penalise an entity's stats, either for a set duration or when a condition is met.",
  "Unless otherwise stated, Debuffs of the same type do not stack — only the copy with the strongest effect applies.",
  "Only a madman would ignore a god's instructions.",
  "Supports Attack Skills, causing them to Cull Rare and Unique Enemies on Hit, and increasing the threshold at which they will Cull Enemies.",
  "Heart of the Well Diamond",
  "Heart of the Well Diamond",
  "Grants Skill",
  "Grants Skill: Level 20 Boneshatter",
];

// Lines poe.ninja renders as several <span>s because they contain keyword
// tooltips. The content script has to join them before it can match a template.
const SPLIT_LINES = [
  ["Gem ", "Quality", " grants ", "Socketed Skills", " an additional effect"],
  [
    "Sorcery Ward's ",
    "Barrier",
    " can also take ",
    "Physical",
    " and ",
    "Chaos",
    " Damage from ",
    "Hits",
  ],
  ["30% increased ", "Charm", " Charges gained"],
  ["Shockwave radius is ", "2 metres"],
];

// A long skill description is rendered as many keyword spans on poe.ninja, so the content
// script has to rebuild the line from the remembered English text before it matches. The
// Contagion description is chunked into 40 character spans to reproduce that.
const longDescription = (() => {
  const rows = JSON.parse(
    readFileSync(path.join(translationDirectory, "lines", "skill_gem_lines.json"), "utf8"),
  );
  return rows.find((row) => row.id.startsWith("Afflict a single enemy with a "))?.id;
})();
if (longDescription) {
  const segments = [];
  for (let index = 0; index < longDescription.length; index += 40) {
    segments.push(longDescription.slice(index, index + 40));
  }
  SPLIT_LINES.push(segments);
  console.log(`긴 설명 span 분할 테스트: ${segments.length}개 span, ${longDescription.length}자`);
} else {
  console.log("!! skill_gem_lines.json 에서 긴 설명을 찾지 못했습니다");
}

// A line whose keywords carry a tooltip trigger: the Korean line must be written back into
// the same spans, so every keyword span still holds its Korean word after translating.
const KEYWORD_CASES = [
  [
    { text: "Create a storm that sucks in enemies and deals " },
    { text: "Physical", keyword: true },
    { text: " damage over time. A Tornado that overlaps an " },
    { text: "Elemental Ground Surface", keyword: true },
    { text: " absorbs that surface's " },
    { text: "Debuff", keyword: true },
    {
      text: ", applying it to enemies inside the Tornado and causing the Tornado to deal extra damage of that element.",
    },
  ],
  // "Slowing" of the line against "Slow" -> 감속 in the buff data (the description prints
  // 감속시킵니다).
  [
    {
      text: "Conjures a rootbound fissure that crawls forward, damaging enemies in its path. While the fissure persists, vines lash out from it and attach to nearby enemies, damaging and ",
    },
    { text: "Slowing", keyword: true },
    { text: " them." },
  ],
  // "Channel" of the line against "Channelling" -> 집중 유지 in the keyword data; the first
  // occurrence is inflected ("집중을 유지하여") and the line starts with an empty span.
  [
    { text: "" },
    { text: "Channel", keyword: true },
    {
      text: " to build destructive energy around you. Releasing the energy causes a devastating explosion that is larger and more intense the longer you ",
    },
    { text: "Channel", keyword: true },
    { text: " for." },
  ],
];

// poe.ninja breakdown row labels (general/keyword.json).
const KEYWORD_LABELS = [
  "Gem Level",
  "Gem Quality",
  "Cast rate",
  "Crit chance",
  "Crit multiplier",
  "AoE radius",
  "Hit chance",
  "Modifiers",
  "Increased",
  "Item",
  "Tree",
  "Attack rate",
];

const pageHtml = `<!doctype html>
<html lang="en">
  <body>
    <div class="item">
      ${LINES.map(
        (line, index) =>
          `<div class="line" data-id="${index}">${line
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</div>`,
      ).join("\n      ")}
    </div>
    <div class="split">
      ${SPLIT_LINES.map(
        (segments, index) =>
          `<div class="split-line" data-id="${index}">${segments
            .map((segment) => `<span>${segment}</span>`)
            .join("")}</div>`,
      ).join("\n      ")}
    </div>
    <div class="keyword">
      ${KEYWORD_CASES.map(
        (segments, index) =>
          `<div class="keyword-line" data-id="${index}">${segments
            .map(
              (segment) =>
                `<span${segment.keyword ? ' class="underline decoration-dotted" data-tooltip-trigger="true"' : ""}>${segment.text}</span>`,
            )
            .join("")}</div>`,
      ).join("\n      ")}
    </div>
    <div class="misc">
      <div data-variant="subdued" data-scale="10_caption"><span class="text-emerald-500">9.6</span>m radius · <span class="text-emerald-500">8</span>s duration</div>
      <div><span class="text-emerald-500">5</span>proj ·</div>
      <div class="truncate" title="Dire Gorget, Absent Amulet">Dire Gorget, Absent Amulet</div>
      <div class="truncate" title="Ab Aeterno, Adonia's Ego">Ab Aeterno, Adonia's Ego</div>
      <div>The hit's 100% plus the extra crit damage below</div>
      <div>Click the row for the full breakdown</div>
      <div>Converted from Physical (66%)</div>
      <div>Bifurcated Crit Damage Bonus (12%)</div>
      <h2 slot="title" class="text-lg!">Fire Damage · 38,150</h2>
      <h1 style="color: gold"><div>Runeseeker's Call</div>Runemastered Runic Fork</h1>
      <h1 style="color: gold"><div>Guiding Palm</div>Shrine Sceptre (Legacy)</h1>
      <h1 style="color: gold"><div>Andvarius</div>Ring</h1>
      <div>Heart of the Well Diamond</div>
      <div><span>more</span><span class="whitespace-nowrap">×2.5</span></div>
      <div>More</div>
      ${KEYWORD_LABELS.map((label) => `<div>${label}</div>`).join("\n      ")}
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
await page.addScriptTag({ content: contentScript });

const deadline = Date.now() + 30000;
while (Date.now() < deadline && !logs.some((text) => text.includes("속성번역수"))) {
  await page.waitForTimeout(50);
}
const loadLog = logs.find((text) => text.includes("속성번역수"));
if (!loadLog) {
  throw new Error(`번역 데이터가 로드되지 않았습니다: ${JSON.stringify(logs)}`);
}

const rendered = await page.$$eval(".line", (elements) =>
  elements.map((element) => ({
    id: Number(element.dataset.id),
    text: element.textContent.replace(/\s+/g, " ").trim(),
  })),
);
const direct = await page.evaluate((lines) => {
  const api = globalThis.__poeNinjaKoreanTranslation;
  return lines.map((line) => api.translate(line) ?? null);
}, LINES);

console.log(loadLog);
console.log("\n[보네샤터 툴팁 줄]");
let translated = 0;
for (const line of rendered) {
  const source = LINES[line.id];
  const isKorean = /[가-힣]/.test(line.text);
  if (isKorean) {
    translated += 1;
  }
  console.log(`  ${isKorean ? "O" : "X"} ${source}`);
  console.log(`      dom=${JSON.stringify(line.text)} api=${JSON.stringify(direct[line.id])}`);
}
console.log(`\n번역됨 ${translated} / ${rendered.length}`);

const splitRendered = await page.$$eval(".split-line", (elements) =>
  elements.map((element) => ({
    id: Number(element.dataset.id),
    text: element.textContent.replace(/\s+/g, " ").trim(),
  })),
);
const splitDirect = await page.evaluate((lines) => {
  const api = globalThis.__poeNinjaKoreanTranslation;
  return lines.map((segments) => api.translate(segments.join("")) ?? null);
}, SPLIT_LINES);

console.log("\n[span 으로 쪼개진 줄]");
let splitTranslated = 0;
for (const line of splitRendered) {
  const source = SPLIT_LINES[line.id].join("");
  const isKorean = /[가-힣]/.test(line.text);
  if (isKorean) {
    splitTranslated += 1;
  }
  console.log(`  ${isKorean ? "O" : "X"} ${source}`);
  console.log(
    `      dom=${JSON.stringify(line.text)} api=${JSON.stringify(splitDirect[line.id])}`,
  );
}
console.log(`\nspan 분할 번역됨 ${splitTranslated} / ${splitRendered.length}`);

const keywordRendered = await page.$$eval(".keyword-line", (elements) =>
  elements.map((element) => ({
    id: Number(element.dataset.id),
    text: element.textContent.replace(/\s+/g, " ").trim(),
    spans: [...element.children].map((span) => span.textContent.trim()),
  })),
);
console.log("\n[키워드 툴팁 span 보존]");
for (const line of keywordRendered) {
  const source = KEYWORD_CASES[line.id];
  const keywordIndices = source.map((segment, index) => (segment.keyword ? index : -1)).filter((index) => index >= 0);
  const anchored = keywordIndices.filter((index) => /[가-힣]/.test(line.spans[index] ?? ""));
  console.log(`  줄 전체 한글: ${/[가-힣]/.test(line.text) ? "O" : "X"}`);
  console.log(`      ${line.text.slice(0, 90)}…`);
  console.log(
    `  키워드 span 보존: ${anchored.length === keywordIndices.length ? "O" : "X"} ${anchored.length} / ${keywordIndices.length}`,
  );
  for (const index of keywordIndices) {
    console.log(`      [${index}] ${JSON.stringify(source[index].text)} → ${JSON.stringify(line.spans[index] ?? "")}`);
  }
  console.log(`      spans=${JSON.stringify(line.spans)}`);
}

const miscRendered = await page.$$eval(".misc > *", (elements) =>
  elements.map((element) => ({
    text: element.textContent.replace(/\s+/g, " ").trim(),
    title: element.getAttribute("title") ?? "",
  })),
);
console.log("\n[캡션 · 이름 목록 · UI 문구]");
for (const item of miscRendered) {
  console.log(`  ${/[가-힣]/.test(item.text) ? "O" : "X"} ${JSON.stringify(item.text)}`);
  if (item.title) {
    console.log(`      title=${JSON.stringify(item.title)}`);
  }
}

await browser.close();
