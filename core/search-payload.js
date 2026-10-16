// Rebuilds the search payload that userscripts/poe-ninja-translation.user.js
// sends to chrome-extension/page_search.js, so browser demos such as
// korean-search.html can exercise the real extension search logic without an
// extension reload. scripts/test-page-search.mjs asserts that this module and
// the userscript produce identical payloads.

const CORE_DATA_FILES = [
  "names/game_terms.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
];
const INTERFACE_DATA_FILE = "general/poe_ninja.json";
const OPTIONAL_CORE_DATA_FILES = [
  "names/mods.json",
  "names/keywordpopups.json",
  "items/base_item_variants.json",
];
const KEYWORD_DATA_FILE = "general/keyword.json";
const CUSTOM_DATA_FILE = "general/custom.json";
const KOREAN_REGEX = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

export const SEARCH_PAYLOAD_SOURCE = "poe-ninja-korean-translation";

export function normalizeEnglish(value) {
  return value
    .replace(/_/g, " ")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export function normalizeKorean(value) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, "")
    .trim()
    .toLocaleLowerCase("ko");
}

export function buildSearchPayload({
  interfaceTranslations,
  coreData = {},
  optionalCoreRows = [],
  keywordData,
  customData,
}) {
  const englishAliases = new Map();
  const koreanLabelByEnglish = new Map();
  const uniqueItemNames = new Set();
  const itemClassByBaseItemId = new Map();
  const uniqueItemBaseItems = new Map();
  const uniqueItemIdsByItemClass = new Map();

  function addAlias(englishName, koreanName) {
    if (
      typeof englishName !== "string" ||
      typeof koreanName !== "string" ||
      !englishName.trim() ||
      !KOREAN_REGEX.test(koreanName)
    ) {
      return;
    }
    const key = normalizeEnglish(englishName);
    const label = normalizeKorean(koreanName);
    if (!key || !label) {
      return;
    }
    const labels = englishAliases.get(key) ?? new Set();
    labels.add(label);
    englishAliases.set(key, labels);
    if (!koreanLabelByEnglish.has(key)) {
      koreanLabelByEnglish.set(key, koreanName.trim());
    }
  }

  function addTranslation(englishName, koreanName, override = false) {
    if (
      typeof englishName !== "string" ||
      typeof koreanName !== "string" ||
      !englishName.trim() ||
      !koreanName.trim()
    ) {
      return;
    }
    if (override) {
      englishAliases.delete(normalizeEnglish(englishName));
    }
    addAlias(englishName, koreanName);
  }

  function addRows(rows, override = false) {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        addTranslation(row.id, row.ko, override);
      }
    }
  }

  function addObjectTranslations(object, override = false) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return;
    }
    for (const [englishName, koreanName] of Object.entries(object)) {
      addTranslation(englishName, koreanName, override);
    }
  }

  function registerBaseItemTypes(rows) {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.itemClass !== "string"
      ) {
        continue;
      }
      const baseItemId = normalizeEnglish(row.id);
      const itemClass = normalizeEnglish(row.itemClass);
      if (baseItemId && itemClass) {
        itemClassByBaseItemId.set(baseItemId, itemClass);
      }
    }
  }

  function registerUniqueItems(rows) {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      if (!row || typeof row.id !== "string") {
        continue;
      }
      const key = normalizeEnglish(row.id);
      if (!key) {
        continue;
      }
      uniqueItemNames.add(key);
      if (typeof row.baseItem === "string") {
        const baseItemKey = normalizeEnglish(row.baseItem);
        if (baseItemKey) {
          uniqueItemBaseItems.set(key, baseItemKey);
        }
      }
    }
  }

  // item class ("shield") -> unique items whose base item belongs to it.
  function rebuildUniqueItemIdsByItemClass() {
    uniqueItemIdsByItemClass.clear();
    for (const [uniqueItemId, baseItemId] of uniqueItemBaseItems) {
      const itemClass = itemClassByBaseItemId.get(baseItemId);
      if (!itemClass) {
        continue;
      }
      const uniqueItemIds = uniqueItemIdsByItemClass.get(itemClass) ?? [];
      uniqueItemIds.push(uniqueItemId);
      uniqueItemIdsByItemClass.set(itemClass, uniqueItemIds);
    }
  }

  addObjectTranslations(interfaceTranslations);
  for (const fileName of CORE_DATA_FILES) {
    const payload = coreData[fileName];
    if (Array.isArray(payload)) {
      addRows(payload);
    } else {
      addObjectTranslations(payload);
    }
  }
  registerBaseItemTypes(coreData["items/base_items.json"]);
  registerUniqueItems(coreData["items/unique_items.json"]);
  rebuildUniqueItemIdsByItemClass();
  // 선택적인 코어 파일(mods.json)은 core 바로 뒤에 온다(원래 우선순위 유지).
  if (optionalCoreRows.length > 0) {
    addRows(optionalCoreRows);
  }
  // `id` 에 `#` 자리표시자가 있는 행은 유저스크립트에서 스탯 템플릿으로만 등록되므로(별칭 없음)
  // 페이로드도 같은 규칙을 따른다.
  const withoutStatTemplates = (rows) =>
    Array.isArray(rows)
      ? rows.filter((row) => !(row && typeof row.id === "string" && row.id.includes("#")))
      : rows;
  const keywordRows = withoutStatTemplates(keywordData);
  if (Array.isArray(keywordRows)) {
    addRows(keywordRows, true);
  } else {
    addObjectTranslations(keywordRows, true);
  }
  const customRows = withoutStatTemplates(customData);
  if (Array.isArray(customRows)) {
    addRows(customRows, true);
  } else {
    addObjectTranslations(customRows, true);
  }

  return {
    source: SEARCH_PAYLOAD_SOURCE,
    type: "aliases",
    entries: [...englishAliases].map(([english, korean]) => [
      english,
      [...korean],
    ]),
    labels: [...koreanLabelByEnglish],
    uniqueNames: [...uniqueItemNames],
    itemClassUniqueItems: [...uniqueItemIdsByItemClass],
  };
}

export async function loadSearchPayload(baseUrl, fetchImpl) {
  const request = fetchImpl ?? globalThis.fetch;
  if (typeof request !== "function") {
    throw new TypeError("A fetch implementation is required");
  }
  const base = baseUrl instanceof URL ? baseUrl : new URL(baseUrl, baseUrlBase());
  const requestJson = async (fileName) => {
    const response = await request(new URL(fileName, base));
    if (!response.ok) {
      throw new Error(`Failed to load ${fileName}: HTTP ${response.status}`);
    }
    return response.json();
  };

  const interfaceTranslations = await requestJson(INTERFACE_DATA_FILE);
  const coreData = {};
  const payloads = await Promise.all(
    CORE_DATA_FILES.map(async (fileName) => [fileName, await requestJson(fileName)]),
  );
  for (const [fileName, payload] of payloads) {
    coreData[fileName] = payload;
  }
  const keywordData = await requestJson(KEYWORD_DATA_FILE);
  const customData = await requestJson(CUSTOM_DATA_FILE);
  const optionalCoreRows = [];
  for (const fileName of OPTIONAL_CORE_DATA_FILES) {
    const payload = await requestJson(fileName).catch(() => null);
    if (Array.isArray(payload)) {
      optionalCoreRows.push(...payload);
    }
  }

  return buildSearchPayload({
    interfaceTranslations,
    coreData,
    optionalCoreRows,
    keywordData,
    customData,
  });
}

function baseUrlBase() {
  try {
    return globalThis.location?.href ?? "http://localhost/";
  } catch (error) {
    return "http://localhost/";
  }
}
