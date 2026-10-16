import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { findCodeRoot, resolveSourceFile } from "./source-root.mjs";

// 데이터(translations/)는 기준 폴더에서, 코드(확장/유저스크립트)는 이 파이프라인 기준으로 찾는다.
// 그래서 번역 데이터 폴더에서 실행하든 코드 저장소에서 실행하든 같은 결과가 나온다.
const projectRoot = resolveProjectRoot(import.meta.url);
const codeRoot = findCodeRoot(import.meta.url);
const outputDirectory = path.join(codeRoot, "dist", "poe-ninja-korean");
const translationDirectory = path.join(projectRoot, "translations");
const manifestSource = resolveSourceFile(
  import.meta.url,
  "../chrome-extension/manifest.json",
  "../../sites/ninja/manifest.json",
);
const contentSource = resolveSourceFile(
  import.meta.url,
  "../userscripts/poe-ninja-translation.user.js",
  "../../core/content.js",
);
const pageSearchSource = resolveSourceFile(
  import.meta.url,
  "../chrome-extension/page_search.js",
  "../../sites/ninja/page_search.js",
);
const dataFiles = [
  "names/game_terms.json",
  "names/mods.json",
  "names/keywordpopups.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/base_item_variants.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
  "general/keyword.json",
  "general/custom.json",
  "general/poe_ninja.json",
  "lines/item_mod_lines.json",
  "lines/skill_gem_lines.json",
  "lines/stat_lines.json",
  "lines/flavour_text.json",
  "lines/keyword_definitions.json",
  "names/area_and_quest_names.json",
];

// The layout moved into folders, so remove the previous copy of the translation data
// (and the older flat file names) before copying the current one.
await rm(path.join(outputDirectory, "translations"), { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "translations"), { recursive: true });
await cp(manifestSource, path.join(outputDirectory, "manifest.json"));
await cp(contentSource, path.join(outputDirectory, "content.js"));
await cp(pageSearchSource, path.join(outputDirectory, "page_search.js"));
await Promise.all(
  dataFiles.map(async (fileName) => {
    const target = path.join(outputDirectory, "translations", fileName);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(translationDirectory, fileName), target);
  }),
);

const manifest = JSON.parse(
  await readFile(path.join(outputDirectory, "manifest.json"), "utf8"),
);
if (
  !manifest.content_scripts.some(
    ({ js, world }) => js.includes("content.js") && world !== "MAIN",
  )
) {
  throw new Error("Extension manifest does not point to the generated content script");
}
if (
  !manifest.content_scripts.some(
    ({ js, world }) => js.includes("page_search.js") && world === "MAIN",
  )
) {
  throw new Error("Extension manifest does not point to the page search script");
}

console.log(`Built unpacked Chrome extension at ${outputDirectory}`);
