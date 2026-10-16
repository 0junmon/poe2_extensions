import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Local-only audit: renders poe.ninja PoE 2 pages in Chromium, harvests every
// string the site can display, and compares it with the translation database.
// Output tells us which entries are actually used, which are still missing, and
// which English keys are duplicated across tables.
//
// Usage: node scripts/audit_poe_ninja.mjs [url ...]

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const outputDirectory = path.join(projectRoot, "data", "poe_ninja_audit");
const networkDirectory = path.join(outputDirectory, "network");
const pagesDirectory = path.join(outputDirectory, "pages");

const DATA_FILES = [
  "names/game_terms.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
  "general/keyword.json",
  "general/custom.json",
  "general/poe_ninja.json",
];

const targets =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["https://poe.ninja/poe2/builds/forbiddenrites"];

const waitAfterLoadMs = Number(process.env.AUDIT_WAIT_MS ?? 5000);
const scrollRounds = Number(process.env.AUDIT_SCROLLS ?? 8);

const normalizeEnglish = (value) =>
  value
    .replace(/_/g, " ")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");

async function loadDatabase() {
  const entries = [];
  for (const fileName of DATA_FILES) {
    const payload = JSON.parse(
      await readFile(path.join(translationDirectory, fileName), "utf8"),
    );
    if (Array.isArray(payload)) {
      for (const row of payload) {
        if (row && typeof row.id === "string" && typeof row.ko === "string") {
          entries.push({ fileName, id: row.id, ko: row.ko });
        }
      }
    } else if (payload && typeof payload === "object") {
      for (const [id, ko] of Object.entries(payload)) {
        if (typeof ko === "string") {
          entries.push({ fileName, id, ko });
        }
      }
    }
  }

  const byKey = new Map();
  for (const entry of entries) {
    const key = normalizeEnglish(entry.id);
    if (!key) {
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }
  return { entries, byKey };
}

function findDuplicates(byKey) {
  const duplicates = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) {
      continue;
    }
    duplicates.push({
      key,
      occurrences: list.length,
      files: [...new Set(list.map((entry) => entry.fileName))],
      koValues: [...new Set(list.map((entry) => entry.ko))],
      entries: list.map((entry) => `${entry.fileName}:${entry.id}`),
    });
  }
  return duplicates;
}

async function harvestPage(page) {
  return page.evaluate(() => {
    const texts = new Set();
    const attributes = new Set();
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            ["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName)
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue?.replace(/\s+/g, " ").trim();
        if (value && value.length <= 160) {
          texts.add(value);
        }
      } else {
        for (const attribute of ["placeholder", "title", "aria-label"]) {
          const value = node
            .getAttribute?.(attribute)
            ?.replace(/\s+/g, " ")
            .trim();
          if (value) {
            attributes.add(value);
          }
        }
      }
    }
    const links = [
      ...new Set(
        [...document.querySelectorAll("a[href]")].map(
          (anchor) => anchor.getAttribute("href") ?? "",
        ),
      ),
    ];
    return { texts: [...texts], attributes: [...attributes], links };
  });
}

function summarizeLinks(links) {
  const patterns = new Map();
  for (const link of links) {
    const pattern = link
      .replace(/\?.*$/, "")
      .replace(/[0-9a-f]{12,}/gi, "{hash}")
      .replace(/\d{3,}/g, "{num}")
      .replace(/^\/+|\/+$/g, "");
    patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  }
  return [...patterns.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}

const { entries, byKey } = await loadDatabase();
const duplicates = findDuplicates(byKey);
await mkdir(networkDirectory, { recursive: true });
await mkdir(pagesDirectory, { recursive: true });

console.log(`db entries    : ${entries.length.toLocaleString("en-US")}`);
console.log(`unique keys   : ${byKey.size.toLocaleString("en-US")}`);
console.log(`duplicate keys: ${duplicates.length.toLocaleString("en-US")}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const usedKeys = new Map();
const unmatchedStrings = new Set();
const pageReports = [];

try {
  for (const target of targets) {
    console.log(`\n=== ${target} ===`);
    const page = await context.newPage();
    const requests = [];

    page.on("response", (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      if (!["xhr", "fetch", "document"].includes(resourceType)) {
        return;
      }
      const contentType = response.headers()["content-type"] ?? "";
      requests.push({
        url: response.url(),
        status: response.status(),
        resourceType,
        contentType,
      });
    });

    await page.route("**/*", (route) =>
      ["font", "image", "media"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );

    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(waitAfterLoadMs);
    for (let step = 0; step < scrollRounds; step += 1) {
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(1500);
    }

    const harvested = await harvestPage(page);
    const renderedHtml = await page.content();
    const values = [...new Set([...harvested.texts, ...harvested.attributes])];

    const matched = [];
    const unmatched = [];
    for (const value of values) {
      const list = byKey.get(normalizeEnglish(value));
      if (list) {
        matched.push(value);
        for (const entry of list) {
          usedKeys.set(`${entry.fileName}\u0000${entry.id}`, entry);
        }
      } else {
        unmatched.push(value);
        unmatchedStrings.add(value);
      }
    }

    const jsonEndpoints = [
      ...new Set(
        requests
          .filter((item) => item.contentType.includes("json"))
          .map((item) => item.url),
      ),
    ];

    const report = {
      url: target,
      status: response?.status() ?? null,
      uniqueTexts: harvested.texts.length,
      uniqueAttributes: harvested.attributes.length,
      uniqueValues: values.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      matched,
      unmatched,
      links: harvested.links,
      linkPatterns: summarizeLinks(harvested.links),
      jsonEndpoints,
      requests,
    };
    pageReports.push(report);

    const slug = target
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120);
    const reportPath = path.join(outputDirectory, `page-${slug}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    const htmlPath = path.join(pagesDirectory, `page-${slug}.html`);
    await writeFile(htmlPath, renderedHtml, "utf8");

    console.log(`status        : ${report.status}`);
    console.log(`unique values : ${report.uniqueValues}`);
    console.log(`matched (used): ${report.matchedCount}`);
    console.log(`unmatched     : ${report.unmatchedCount}`);
    console.log(`json endpoints: ${jsonEndpoints.length}`);
    for (const endpoint of jsonEndpoints.slice(0, 8)) {
      console.log(`  ${endpoint}`);
    }
    console.log(`link patterns : ${report.linkPatterns.length}`);
    for (const item of report.linkPatterns.slice(0, 25)) {
      console.log(`  ${item.count.toString().padStart(4, " ")}  ${item.pattern}`);
    }
    console.log(`report        : ${reportPath}`);
    console.log(`dom snapshot  : ${htmlPath}`);
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

const aggregate = {
  usedKeys: [...usedKeys.values()],
  usedKeyCount: usedKeys.size,
  unmatchedStrings: [...unmatchedStrings].sort(),
  unmatchedCount: unmatchedStrings.size,
  duplicates,
  pages: pageReports.map((report) => ({
    url: report.url,
    uniqueValues: report.uniqueValues,
    matchedCount: report.matchedCount,
    unmatchedCount: report.unmatchedCount,
  })),
};

await writeFile(
  path.join(outputDirectory, "audit-summary.json"),
  JSON.stringify(aggregate, null, 2),
  "utf8",
);
await writeFile(
  path.join(pagesDirectory, "index.json"),
  JSON.stringify(
    pageReports.map((report, index) => ({
      page: index + 1,
      url: report.url,
      slug: report.url.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 120),
    })),
    null,
    2,
  ),
  "utf8",
);

console.log("\n=== aggregate ===");
console.log(
  `used db keys  : ${usedKeys.size.toLocaleString("en-US")} / ${entries.length.toLocaleString("en-US")}`,
);
console.log(
  `unmatched strs: ${unmatchedStrings.size.toLocaleString("en-US")}`,
);
console.log("\n--- sample unmatched ---");
for (const value of [...unmatchedStrings].slice(0, 40)) {
  console.log(`  ${value}`);
}
console.log(`\nsummary       : ${path.join(outputDirectory, "audit-summary.json")}`);

