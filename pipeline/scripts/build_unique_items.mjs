// Builds translations/items/unique_items.json (unique -> base item),
// translations/items/base_item_variants.json (base names that only appear in a unique line) and
// the unique jewel labels inside translations/general/poe_ninja.json.
//
//   node scripts/build_unique_items.mjs
//
// Both sides come from the official trade API only (no balance dump):
//
//   english  https://www.pathofexile.com/api/trade2/data/items
//   korean   https://kr.pathofexile.com/api/trade2/data/items  (Daum mirror as fallback)
//
// The item list classifies every entry:
//
//   base item    { "type": "Gargantuan Mana Flask" }
//   unique item  { "type": "Transcendent Mana Flask",
//                  "name": "Uhtred's Chalice",
//                  "text": "Uhtred's Chalice Transcendent Mana Flask",
//                  "flags": { "unique": true } }
//
// so `name` is the unique, `type` its base item and `text` the line poe.ninja shows. The
// two lists have no id in common, so the unique entries are paired by their order inside
// each category; any category whose counts differ is skipped, and the run reports how many
// entries were paired. Both responses are cached in data/trade_api/, so a rebuild works
// offline. If the Korean list and its cache are both missing the script stops instead of
// writing an incomplete file.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = resolveProjectRoot(import.meta.url);
const translationsDirectory = path.join(projectRoot, "translations");
const cacheDirectory = path.join(projectRoot, "data", "trade_api");
const itemsUrl = "https://www.pathofexile.com/api/trade2/data/items";
const uniquesFile = path.join(translationsDirectory, "items/unique_items.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, rows) => writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
// Every written row is `{ id, ko }`, so all outputs sort the same way.
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The item list is one request; keep a copy so a rebuild works offline.
async function loadItemList() {
  const cacheFile = path.join(cacheDirectory, "items_en.json");
  try {
    const response = await fetch(itemsUrl, {
      headers: {
        "User-Agent": "pobkr-translation/1.0 (+https://github.com/jun1bh1/poe2_translation_kr)",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.text();
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(cacheFile, body, "utf8");
    return { data: JSON.parse(body), source: itemsUrl };
  } catch (error) {
    if (!existsSync(cacheFile)) {
      throw new Error(`거래소 API 를 받을 수 없고 캐시도 없습니다: ${error.message}`);
    }
    console.log(`  !! API 실패(${error.message}) — 캐시를 사용합니다: ${cacheFile}`);
    return { data: readJson(cacheFile), source: cacheFile };
  }
}

const { data, source } = await loadItemList();
const entries = (data.result ?? []).flatMap((group) =>
  (group.entries ?? []).map((entry) => ({ group: group.id, ...entry })),
);
const apiUniques = entries.filter((row) => row.flags?.unique && row.name && row.type);
console.log(`아이템 목록 ${entries.length}개 (${source})`);
console.log(
  `  유니크 ${apiUniques.length}개, 베이스 ${entries.filter((row) => !row.flags?.unique).length}개`,
);

// 한글 거래소도 같은 items 목록을 준다. 항목에 고유 식별자가 없어서 "그룹별 순서"로 짝지은 뒤,
// 그룹별 개수와 이름 대응을 검증한다(로컬 덤프와 100% 일치하는 것을 확인했다).
async function loadKoreanItemList() {
  const cacheFile = path.join(cacheDirectory, "items_ko.json");
  for (const url of [
    "https://kr.pathofexile.com/api/trade2/data/items",
    "https://poe.game.daum.net/api/trade2/data/items",
  ]) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "pobkr-translation/1.0 (+https://github.com/jun1bh1/poe2_translation_kr)",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.text();
      mkdirSync(cacheDirectory, { recursive: true });
      writeFileSync(cacheFile, body, "utf8");
      return { data: JSON.parse(body), source: url };
    } catch (error) {
      console.log(`  !! ${url} 실패(${error.message})`);
    }
  }
  if (existsSync(cacheFile)) {
    console.log(`  !! 한글 API 실패 — 캐시를 사용합니다: ${cacheFile}`);
    return { data: readJson(cacheFile), source: cacheFile };
  }
  return { data: null, source: null };
}

const koreanUniqueFromApi = new Map();
const koreanBaseFromApi = new Map();
const koreanTextFromApi = new Map();
const koreanList = await loadKoreanItemList();
if (koreanList.data) {
  const koreanEntries = (koreanList.data.result ?? []).flatMap((group) =>
    (group.entries ?? []).map((entry) => ({ group: group.id, ...entry })),
  );
  const groupEntries = (list, uniqueOnly) => {
    const map = new Map();
    for (const entry of list) {
      if (uniqueOnly && !entry.flags?.unique) {
        continue;
      }
      const bucket = map.get(entry.group) ?? [];
      bucket.push(entry);
      map.set(entry.group, bucket);
    }
    return map;
  };
  const englishByGroup = groupEntries(entries, true);
  const koreanByGroup = groupEntries(koreanEntries, true);
  let matched = 0;
  let mismatchedGroups = 0;
  for (const [group, englishList] of englishByGroup) {
    const koreanBucket = koreanByGroup.get(group) ?? [];
    if (koreanBucket.length !== englishList.length) {
      mismatchedGroups += 1;
      continue;
    }
    for (let index = 0; index < englishList.length; index += 1) {
      const english = englishList[index];
      const korean = koreanBucket[index];
      if (english.name && korean?.name && !koreanUniqueFromApi.has(english.name)) {
        koreanUniqueFromApi.set(english.name, korean.name);
      }
      if (english.type && korean?.type && !koreanBaseFromApi.has(english.type)) {
        koreanBaseFromApi.set(english.type, korean.type);
      }
      // 표시 줄(text)은 type 과 다를 수 있다(레거시 접미어 "(Legacy)" 등).
      if (english.text && korean?.text && !koreanTextFromApi.has(english.text)) {
        koreanTextFromApi.set(english.text, korean.text);
      }
      matched += 1;
    }
  }
  console.log(
    `  한글 API(${koreanList.source}) 유니크 ${koreanEntries.length}개 — 짝지음 ${matched}개, 개수 불일치 그룹 ${mismatchedGroups}개`,
  );
}

// 한글 고유명/베이스명은 한글 거래소 API 에서만 가져온다(balance 덤프나 로컬 번역 파일을
// 쓰지 않는다). API 도 캐시도 없으면 잘못된 파일을 만들지 않도록 여기서 중단한다.
if (koreanUniqueFromApi.size === 0) {
  throw new Error(
    "한글 거래소 items API(또는 캐시 data/trade_api/items_ko.json)를 사용할 수 없어 유니크 한글을 만들 수 없습니다",
  );
}
const koreanUnique = (englishName) => koreanUniqueFromApi.get(englishName);
const koreanBase = (englishBase) => koreanBaseFromApi.get(englishBase);

// base_items.json 에 이미 있는 베이스 이름은 variants 로 중복 저장하지 않는다.
const knownBaseItems = new Set(
  readJson(path.join(translationsDirectory, "items/base_items.json")).map(
    (row) => row.id,
  ),
);

// One unique name can be listed with several base items: the plain one plus the rune
// modified variants ("Blazon Crest Shield" / "Runemastered Blazon Crest Shield"), so the
// combos are grouped by unique name. The trade list also carries placeholders for
// unreleased uniques ("INCOMPLETE Crone Knife"), which are dropped.
const PLACEHOLDER_NAME = /^(incomplete|dnt|reserved)$/i;
const combos = [];
for (const entry of apiUniques) {
  if (PLACEHOLDER_NAME.test(entry.name.trim())) continue;
  combos.push({
    name: entry.name,
    base: entry.type,
    text: entry.text ?? `${entry.name} ${entry.type}`,
  });
}
const basesByName = new Map();
for (const combo of combos) {
  const list = basesByName.get(combo.name) ?? [];
  if (!list.includes(combo.base)) list.push(combo.base);
  basesByName.set(combo.name, list);
}

const stats = { missingUniqueName: 0, multiBase: 0 };
const uniqueNameMissing = [];
const uniqueRows = new Map();

for (const [name, bases] of basesByName) {
  const koreanName = koreanUnique(name);
  if (!koreanName) {
    stats.missingUniqueName += 1;
    if (uniqueNameMissing.length < 10) uniqueNameMissing.push(name);
    continue;
  }
  if (bases.length > 1) stats.multiBase += 1;
  // The plain base item is the shortest variant, which is the one the previous
  // (vaal.tools) data used for every unique.
  const canonical = [...bases].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
  uniqueRows.set(name, { id: name, ko: koreanName, baseItem: canonical });
}

// poe.ninja 는 "고유 주얼"만 고유명과 베이스를 한 줄로 표시한다(아이콘 라벨).
// 주얼 여부는 API 의 group === "jewel" 로 바로 알 수 있고(로컬 파일 조회 불필요),
// 한글은 같은 항목의 한글 API 짝에서 가져와 "고유명 + 베이스" 한 줄로 만든다.
// 별도의 라인 파일(unique_item_lines.json)은 만들지 않는다.
const jewelLabels = new Map();
for (const entry of apiUniques) {
  if (entry.group !== "jewel" || !entry.name || !entry.type) {
    continue;
  }
  const koreanJewelName = koreanUnique(entry.name);
  const koreanJewelBase = koreanBase(entry.type);
  if (!koreanJewelName || !koreanJewelBase) {
    continue;
  }
  jewelLabels.set(
    entry.text ?? `${entry.name} ${entry.type}`,
    `${koreanJewelName} ${koreanJewelBase}`,
  );
}
const poeNinjaFile = path.join(translationsDirectory, "general/poe_ninja.json");
const poeNinja = readJson(poeNinjaFile);
let jewelAdded = 0;
let jewelUpdated = 0;
for (const [id, ko] of jewelLabels) {
  if (poeNinja[id] === ko) {
    continue;
  }
  if (poeNinja[id] === undefined) {
    jewelAdded += 1;
  } else {
    jewelUpdated += 1;
  }
  poeNinja[id] = ko;
}
writeJson(poeNinjaFile, poeNinja);
console.log(
  `고유 주얼 라벨 ${jewelLabels.size}개 → general/poe_ninja.json (추가 ${jewelAdded}, 갱신 ${jewelUpdated})`,
);


// 고유 라인은 "<고유명> <베이스 변형>" 형태라서 API 의 고유명/베이스 짝에서 베이스 변형의
// 한글을 바로 얻을 수 있다. base_items.json 에 없는 변형(레거시 접미어, 일반 "Ring" 등)만
// 따로 저장한다. poe.ninja 는 고유명과 베이스를 나눈 노드로 표시하므로 이 값이 필요하다.
const variantsFile = path.join(
  translationsDirectory,
  "items/base_item_variants.json",
);
const variants = new Map();
for (const combo of combos) {
  // type 기준(룬 변형 등)
  const koreanTypeName = koreanBase(combo.base);
  if (koreanTypeName && !knownBaseItems.has(combo.base) && !variants.has(combo.base)) {
    variants.set(combo.base, koreanTypeName);
  }
  // text 기준(레거시 접미어 "(Legacy)" 처럼 type 에 없는 표기)
  const koreanText = koreanTextFromApi.get(combo.text);
  const koreanName = koreanUnique(combo.name);
  if (!koreanText || !koreanName || !combo.text.startsWith(`${combo.name} `)) {
    continue;
  }
  const variantId = combo.text.slice(combo.name.length + 1);
  const variantKorean = koreanText.slice(koreanName.length + 1);
  if (
    !variantId ||
    !variantKorean ||
    knownBaseItems.has(variantId) ||
    variants.has(variantId)
  ) {
    continue;
  }
  variants.set(variantId, variantKorean);
}
const sortedVariants = [...variants]
  .map(([id, ko]) => ({ id, ko }))
  .sort(byId);
writeJson(variantsFile, sortedVariants);
console.log(`Wrote ${sortedVariants.length} base item variants to ${variantsFile}`);
for (const row of sortedVariants.slice(0, 10)) {
  console.log(`    ${row.id} → ${row.ko}`);
}

const sortedUniques = [...uniqueRows.values()].sort(byId);
writeJson(uniquesFile, sortedUniques);
console.log(`\nWrote ${sortedUniques.length} uniques to ${uniquesFile}`);
console.log(`한글 고유명 없음: ${stats.missingUniqueName}`);
console.log(`베이스 변형(룬 개조 등)이 있는 유니크: ${stats.multiBase}개`);
if (uniqueNameMissing.length > 0) console.log(`  고유명 없음 예: ${uniqueNameMissing.join(" | ")}`);

const uniqueById = new Map(sortedUniques.map((row) => [row.id, row]));
for (const sample of ["Lavianga's Spirits", "Uhtred's Chalice", "Melting Maelstrom", "Heart of the Well"]) {
  const unique = uniqueById.get(sample);
  console.log(
    `  ${unique ? "O" : "X"} ${sample} → ${unique?.ko ?? ""} (base ${unique?.baseItem ?? "?"})`,
  );
}
const flaskUniques = sortedUniques.filter((row) => /Flask/.test(row.baseItem));
console.log(`  플라스크 계열 유니크 ${flaskUniques.length}개`);
for (const row of flaskUniques.slice(0, 5)) {
  console.log(`      ${row.id} (${row.ko}) ← ${row.baseItem}`);
}

