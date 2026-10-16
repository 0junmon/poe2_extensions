import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

// Local-only probe: checks how poe.ninja serves its PoE 2 build pages so we can
// decide whether a Playwright crawl or API harvesting is the right approach.
const projectRoot = resolveProjectRoot(import.meta.url);
const targetUrl =
  process.argv[2] ?? "https://poe.ninja/poe2/builds/forbiddenrites";
const outputDirectory = path.join(projectRoot, "data", "poe_ninja_probe");

const response = await fetch(targetUrl, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  },
});
const html = await response.text();

const count = (pattern) => (html.match(pattern) ?? []).length;
const scriptSources = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(
  (match) => match[1],
);
const internalLinks = [
  ...new Set(
    [...html.matchAll(/href="(\/poe2\/[^"]*)"/gi)].map((match) => match[1]),
  ),
];

console.log(`target        : ${targetUrl}`);
console.log(`status        : ${response.status} ${response.statusText}`);
console.log(`bytes         : ${html.length.toLocaleString("en-US")}`);
console.log(`korean chars  : ${count(/[\uAC00-\uD7A3]/g)}`);
console.log(`__NEXT_DATA__ : ${html.includes("__NEXT_DATA__")}`);
console.log(`next flight   : ${html.includes("__next_f")}`);
console.log(`script tags   : ${count(/<script/gi)}`);
console.log(`script srcs   : ${scriptSources.length}`);
console.log(
  `inline script bytes: ${[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].length)
    .reduce((a, b) => a + b, 0)
    .toLocaleString("en-US")}`,
);
console.log("--- script srcs ---");
for (const source of scriptSources) {
  console.log(`  ${source}`);
}
console.log(`--- /poe2/ links (${internalLinks.length}) ---`);
for (const link of internalLinks.slice(0, 60)) {
  console.log(`  ${link}`);
}

await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(
  outputDirectory,
  `${targetUrl.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.html`,
);
await writeFile(outputPath, html, "utf8");
console.log(`saved         : ${outputPath}`);
