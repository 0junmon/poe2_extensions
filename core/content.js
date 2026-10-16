// ==UserScript==
// @name         poe 닌자 한글 검색
// @namespace    poe2-ninja-korean-search
// @version      0.6.18
// @description  Korean translation and search for poe.ninja PoE 2
// @match        https://poe.ninja/poe2/*
// @match        https://www.poe.ninja/poe2/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "[poe 닌자 한글 검색]";
  const DATA_BASE_URL =
    "https://raw.githubusercontent.com/jun1bh1/poe2_translation_kr/4f5a7423f055cc3be489e994308f4313dfd1e627/translations/";
  const CORE_DATA_FILES = [
    "names/game_terms.json",
    "names/name_dictionary.json",
    "items/base_items.json",
    "items/item_classes.json",
    "items/unique_items.json",
    "names/character_classes.json",
  ];
  const INTERFACE_DATA_FILE = "general/poe_ninja.json";
  // `names/game_terms.json` 에서 떼어 낸 mods 테이블. 예전 데이터 커밋에는 없을 수 있어
  // 실패해도 계속 진행한다(core 바로 뒤, 라인 데이터보다 먼저 = 원래 우선순위 유지).
  const OPTIONAL_CORE_DATA_FILES = [
    "names/mods.json",
    "names/keywordpopups.json",
    "items/base_item_variants.json",
  ];
  // Manually curated terms and keywords; they win over the harvested game data.
  const KEYWORD_DATA_FILE = "general/keyword.json";
  // Line data for item mods, skill gems, the game's own stat description files and
  // the proper names outside of tooltips; every file uses the same row format.
  const STAT_LINE_DATA_FILES = [
    "lines/item_mod_lines.json",
    "lines/skill_gem_lines.json",
    "lines/stat_lines.json",
    "lines/flavour_text.json",
    "lines/keyword_definitions.json",
    "names/area_and_quest_names.json",
  ];
  // Manual overrides, loaded last so that they win over every other file.
  const CUSTOM_DATA_FILE = "general/custom.json";
  const KOREAN_REGEX = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
  // Only "고유" is a keyword, and a partial input (고, 유, 고유) is enough.
  const UNIQUE_SEARCH_KEYWORD = "고유";
  const MAX_MATCH_CACHE_ENTRIES = 20000;
  // A skill description is rendered as a handful of keyword spans and can be several
  // hundred characters long, so the joined line is allowed to be long.
  const MAX_STAT_LINE_LENGTH = 2000;
  const englishAliases = new Map();
  const koreanLabelByEnglish = new Map();
  const koreanSearchCache = new Map();
  const englishNameMatchCache = new Map();
  const uniqueItemNames = new Set();
  const itemClassByBaseItemId = new Map();
  const uniqueItemBaseItems = new Map();
  const uniqueItemIdsByItemClass = new Map();
  const translations = new Map();
  const translationTemplates = [];
  // Official trade API stat texts ("# to maximum Life" -> "생명력 최대치 #").
  const statTemplates = [];
  const statTemplatesByPrefix = new Map();
  const statTranslationCache = new Map();
  const composedTranslationCache = new Map();
  // A value is a number, optionally a range and optionally wrapped in brackets
  // ("60", "+35%", "(1—20)").
  const TEMPLATE_VALUE_PATTERN = "(\\(?[-+]?\\d[\\d.,]*(?:[—~]\\d[\\d.,]*)?\\)?)";
  // A bucket key is only used for templates that start with a plain word.
  const PREFIX_WORD_PATTERN = /^[a-z'’]+$/;
  // A value made of numbers and separators only ("(200—724)%") needs no translation.
  const NUMERIC_VALUE_PATTERN = /^[\d\s.,()%+\-—~]+$/;
  // poe.ninja renders small captions ("9.6m radius · 8s duration", "crit ·", "5proj /") as
  // value spans plus short text fragments. The unit letter (k/m/b/s) has to stay as it is —
  // translating it would break the number — so only the single word is replaced with the word
  // of the data ("radius" -> 반경, "crit" -> 치명타).
  const CAPTION_FRAGMENT_PATTERN = /^([kmbs])?\s*([a-z][a-z'.-]*)(\s*[·/])?$/;
  // A list of names ("Dire Gorget, Absent Amulet") is translated part by part, so that a part
  // without data stays in English instead of turning the whole row into a half translation.
  const LIST_PART_MAX_LENGTH = 40;
  const LIST_PART_MAX_WORDS = 5;
  // A list separates its parts with a comma or a middle dot ("Fire Damage · 38,150").
  const LIST_SEPARATORS = [", ", " · "];
  // Templates that start with a value are grouped under this key instead of a word.
  const VALUE_FIRST_PREFIX = "\u0000";
  // poe.ninja prints the current place as "<area> - <quest>" ("Halls of the Dead - Ngamahu's Test").
  const DASH_SEPARATOR = " - ";
  const pendingSubtrees = new Set();
  const pendingTextNodes = new Set();
  const pendingAttributeElements = new Set();
  const originalIndexOf = String.prototype.indexOf;
  let translationsReady = false;
  let aliasesLoaded = false;
  let subtreeFlushScheduled = false;
  let translationEnabled = true;
  let observer;
  const originalTextByNode = new Map();
  const originalAttributesByElement = new Map();

  function normalizeEnglish(value) {
    return value
      .replace(/_/g, " ")
      .replace(/['’]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("en");
  }

  function normalizeKorean(value) {
    return value
      .normalize("NFC")
      .replace(/\s+/g, "")
      .trim()
      .toLocaleLowerCase("ko");
  }

  // "고유"는 일부만 입력해도(예: 고, 유) 고유 아이템 검색이 켜진다.
  function isUniqueKeywordQuery(normalizedQuery) {
    if (!normalizedQuery) {
      return false;
    }
    return UNIQUE_SEARCH_KEYWORD.includes(normalizedQuery);
  }

  function requestJson(fileName) {
    const getExtensionUrl = globalThis.chrome?.runtime?.getURL;
    if (typeof getExtensionUrl === "function") {
      const url = getExtensionUrl(`translations/${fileName}`);
      return fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load ${fileName}: HTTP ${response.status}`,
          );
        }
        return response.json().catch((error) => {
          throw new Error(`Invalid JSON in ${fileName}: ${error.message}`);
        });
      });
    }

    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(
        new Error("No extension resource or userscript request API is available"),
      );
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: new URL(fileName, DATA_BASE_URL).href,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(`Failed to load ${fileName}: HTTP ${response.status}`),
            );
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(new Error(`Invalid JSON in ${fileName}: ${error.message}`));
          }
        },
        onerror() {
          reject(new Error(`Network error while loading ${fileName}`));
        },
        ontimeout() {
          reject(new Error(`Timed out while loading ${fileName}`));
        },
      });
    });
  }

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

  function addTranslation(
    englishName,
    koreanName,
    override = false,
    addSearchAlias = true,
  ) {
    if (
      typeof englishName !== "string" ||
      typeof koreanName !== "string" ||
      !englishName.trim() ||
      !koreanName.trim()
    ) {
      return;
    }
    const key = normalizeEnglish(englishName);
    if (override) {
      translations.set(key, koreanName);
      englishAliases.delete(key);
    } else if (!translations.has(key)) {
      translations.set(key, koreanName);
    }
    if (addSearchAlias) {
      addAlias(englishName, koreanName);
    }
  }

  function addTranslationTemplate(englishName, koreanName, override = false) {
    const marker = "{0}";
    const normalizedEnglish = normalizeEnglish(englishName);
    const normalizedKorean = koreanName.trim();
    const englishMarkerIndex = normalizedEnglish.indexOf(marker);
    const koreanMarkerIndex = normalizedKorean.indexOf(marker);
    if (
      englishMarkerIndex < 0 ||
      normalizedEnglish.indexOf(marker, englishMarkerIndex + marker.length) >= 0 ||
      koreanMarkerIndex < 0 ||
      normalizedKorean.indexOf(marker, koreanMarkerIndex + marker.length) >= 0
    ) {
      return;
    }

    const prefix = normalizedEnglish.slice(0, englishMarkerIndex);
    const suffix = normalizedEnglish.slice(englishMarkerIndex + marker.length);
    const template = {
      key: normalizedEnglish,
      pattern: new RegExp(
        `^${escapeRegExp(prefix)}(.+?)${escapeRegExp(suffix)}$`,
      ),
      koreanPrefix: normalizedKorean.slice(0, koreanMarkerIndex),
      koreanSuffix: normalizedKorean.slice(koreanMarkerIndex + marker.length),
    };
    const existingIndex = translationTemplates.findIndex(
      (entry) => entry.key === normalizedEnglish,
    );
    if (existingIndex < 0) {
      translationTemplates.push(template);
    } else if (override) {
      translationTemplates[existingIndex] = template;
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function addRows(rows, override = false, addSearchAliases = true) {
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      if (row && typeof row.id === "string" && typeof row.ko === "string") {
        if (row.id.includes("{0}") && row.ko.includes("{0}")) {
          addTranslationTemplate(row.id, row.ko, override);
        }
        addTranslation(row.id, row.ko, override, addSearchAliases);
      }
    }
  }

  // Attribute/stat texts extracted from the official trade API
  // (`scripts/build_trade_stats.mjs` -> `translations/trade_stats.json`).
  //
  // The `#` markers of the trade syntax become numeric placeholders:
  //   "# to maximum Life"        + "+35 to maximum Life"  -> "생명력 최대치 +35"
  //   "Adds # to # Physical Damage" + "Adds 3 to 7 ..."   -> "물리 피해 3~7 추가"
  function addStatRows(rows, override = false) {
    if (!Array.isArray(rows)) {
      return;
    }
    const byKey = new Map(statTemplates.map((template) => [template.key, template]));
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.ko !== "string") {
        continue;
      }
      const english = row.id.trim();
      const korean = row.ko.trim();
      if (!english || !korean) {
        continue;
      }
      if (!english.includes("#")) {
        // A value-free text ("Cannot be Frozen"): translated exactly as-is.
        addTranslation(english, korean, override, false);
        continue;
      }
      const normalizedEnglish = normalizeEnglish(english);
      const parts = normalizedEnglish.split("#");
      // A Korean line may carry indexed placeholders ("{1}초 동안 {0} 생명력 회복") because
      // it uses the English values in another order, so the captured groups are mapped
      // back through that order when the line is translated.
      const koreanOrder = [...korean.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
      const koreanParts = koreanOrder.length > 0 ? korean.split(/\{\d+\}/) : korean.split("#");
      if (parts.length !== koreanParts.length || (!override && byKey.has(normalizedEnglish))) {
        continue;
      }
      byKey.set(normalizedEnglish, {
        key: normalizedEnglish,
        prefixKey: statTemplatePrefixKey(parts[0]),
        pattern: new RegExp(
          `^${parts.map((part) => escapeRegExp(part)).join(TEMPLATE_VALUE_PATTERN)}$`,
        ),
        koreanParts,
        koreanValueOrder: koreanOrder.length > 0 ? koreanOrder : undefined,
      });
    }
    statTemplates.length = 0;
    statTemplates.push(...byKey.values());
    // Longer templates first, so that "# to maximum Life per # Strength"
    // is preferred over "# to maximum Life".
    statTemplates.sort((a, b) => b.key.length - a.key.length);
    // Only the templates that can start with the same word are tried, so a page
    // with thousands of text nodes does not run thousands of patterns.
    statTemplatesByPrefix.clear();
    for (const template of statTemplates) {
      const bucket = statTemplatesByPrefix.get(template.prefixKey) ?? [];
      bucket.push(template);
      statTemplatesByPrefix.set(template.prefixKey, bucket);
    }
    statTranslationCache.clear();
    composedTranslationCache.clear();
  }

  function statTemplatePrefixKey(literalPrefix) {
    const firstWord = literalPrefix.split(" ")[0] ?? "";
    if (!PREFIX_WORD_PATTERN.test(firstWord)) {
      return VALUE_FIRST_PREFIX;
    }
    return firstWord;
  }

  // "1—20" is the English range separator; Korean text uses "1~20".
  function formatStatValue(value) {
    return value ? value.replace(/—/g, "~") : value;
  }

  function addObjectTranslations(object, override = false) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return;
    }
    for (const [englishName, koreanName] of Object.entries(object)) {
      addTranslation(englishName, koreanName, override);
    }
  }

  function addCustomTranslations(custom) {
    if (Array.isArray(custom)) {
      // `#` 자리표시자 행은 라인 파일과 같은 스탯 템플릿으로 등록한다(값 개수 제한 없음,
      // 한국어에서 {0}/{1} 로 순서 변경 가능). 나머지는 {0} 템플릿/일반 행으로 처리한다.
      const statRows = custom.filter(
        (row) => row && typeof row.id === "string" && row.id.includes("#"),
      );
      const otherRows = custom.filter((row) => !statRows.includes(row));
      if (otherRows.length > 0) {
        addRows(otherRows, true);
      }
      if (statRows.length > 0) {
        addStatRows(statRows, true);
      }
      return;
    }
    addObjectTranslations(custom, true);
  }

  function registerBaseItemTypes(rows) {
    if (!Array.isArray(rows)) {
      return;
    }
    itemClassByBaseItemId.clear();
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
    rebuildUniqueItemIdsByItemClass();
    koreanSearchCache.clear();
    englishNameMatchCache.clear();
  }

  function registerUniqueItems(rows) {
    if (!Array.isArray(rows)) {
      return;
    }
    uniqueItemNames.clear();
    uniqueItemBaseItems.clear();
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
    rebuildUniqueItemIdsByItemClass();
    koreanSearchCache.clear();
    englishNameMatchCache.clear();
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

  function resolveKoreanQuery(query) {
    const normalizedQuery = normalizeKorean(query);
    if (!normalizedQuery) {
      return {
        normalizedQuery: "",
        englishNames: [],
        itemClasses: [],
        uniqueItemIds: [],
        searchNames: [],
        uniqueKeyword: false,
      };
    }
    const cached = koreanSearchCache.get(normalizedQuery);
    if (cached) {
      return cached;
    }

    const uniqueKeyword = isUniqueKeywordQuery(normalizedQuery);
    const englishNames = [];
    const seenNames = new Set();
    const pushName = (name) => {
      if (typeof name === "string" && name && !seenNames.has(name)) {
        seenNames.add(name);
        englishNames.push(name);
      }
    };

    if (uniqueKeyword) {
      for (const name of uniqueItemNames) {
        pushName(name);
      }
    }
    for (const [englishName, koreanNames] of englishAliases) {
      if ([...koreanNames].some((name) => name.includes(normalizedQuery))) {
        pushName(englishName);
      }
    }

    const itemClasses = [];
    const uniqueItemIds = [];
    if (!uniqueKeyword) {
      // The 고유 keyword already surfaces every unique item, so item class
      // expansion is skipped for it. For other queries an item class such as
      // "Shield" (방패) pulls in the unique items whose base item belongs to
      // that class.
      const expandedUniqueItemIds = new Set();
      for (const name of englishNames) {
        const classUniqueItemIds = uniqueItemIdsByItemClass.get(name);
        if (!classUniqueItemIds) {
          continue;
        }
        itemClasses.push(name);
        for (const uniqueItemId of classUniqueItemIds) {
          if (expandedUniqueItemIds.has(uniqueItemId)) {
            continue;
          }
          expandedUniqueItemIds.add(uniqueItemId);
          uniqueItemIds.push(uniqueItemId);
        }
      }
    }

    const searchNames = [...englishNames];
    const seenSearchNames = new Set(searchNames);
    for (const uniqueItemId of uniqueItemIds) {
      if (seenSearchNames.has(uniqueItemId)) {
        continue;
      }
      seenSearchNames.add(uniqueItemId);
      searchNames.push(uniqueItemId);
    }

    const resolution = {
      normalizedQuery,
      englishNames,
      itemClasses,
      uniqueItemIds,
      searchNames,
      uniqueKeyword,
    };
    if (koreanSearchCache.size >= MAX_MATCH_CACHE_ENTRIES) {
      koreanSearchCache.clear();
    }
    koreanSearchCache.set(normalizedQuery, resolution);
    return resolution;
  }

  function getEnglishNamesForKoreanSearch(query) {
    return resolveKoreanQuery(query).searchNames;
  }

  function matchesEnglishName(target, search) {
    const normalizedQuery = normalizeKorean(search);
    if (!normalizedQuery) {
      return false;
    }
    const names = getEnglishNamesForKoreanSearch(search);
    if (names.length === 0) {
      return false;
    }
    const cacheKey = `${normalizedQuery}\u0000${target}`;
    const cached = englishNameMatchCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const matched = names.some((name) => target.includes(name));
    if (englishNameMatchCache.size >= MAX_MATCH_CACHE_ENTRIES) {
      englishNameMatchCache.clear();
    }
    englishNameMatchCache.set(cacheKey, matched);
    return matched;
  }

  function installKoreanSearch() {
    String.prototype.indexOf = function (search, ...args) {
      if (
        aliasesLoaded &&
        typeof search === "string" &&
        KOREAN_REGEX.test(search) &&
        matchesEnglishName(normalizeEnglish(String(this)), search)
      ) {
        return 0;
      }
      return originalIndexOf.call(this, search, ...args);
    };
  }

  function translateStatText(normalizedEnglish, allowComposed = true) {
    if (statTemplates.length === 0 || !/\d/.test(normalizedEnglish)) {
      return undefined;
    }
    if (statTranslationCache.has(normalizedEnglish)) {
      return statTranslationCache.get(normalizedEnglish);
    }
    const firstWord = normalizedEnglish.split(" ")[0] ?? "";
    const candidates =
      statTemplatesByPrefix.get(
        PREFIX_WORD_PATTERN.test(firstWord) ? firstWord : VALUE_FIRST_PREFIX,
      ) ?? [];
    let translated;
    for (const template of candidates) {
      const match = normalizedEnglish.match(template.pattern);
      if (!match) {
        continue;
      }
      const koreanValueOrder = template.koreanValueOrder;
      translated = template.koreanParts[0];
      for (let index = 1; index < template.koreanParts.length; index += 1) {
        const value = koreanValueOrder
          ? match[koreanValueOrder[index - 1] + 1]
          : match[index];
        translated += `${formatStatValue(value)}${template.koreanParts[index]}`;
      }
      break;
    }
    if (!translated && allowComposed) {
      translated = translateComposedStatText(normalizedEnglish);
    }
    if (statTranslationCache.size < MAX_MATCH_CACHE_ENTRIES) {
      statTranslationCache.set(normalizedEnglish, translated);
    }
    return translated;
  }

  // A tooltip line is often a label plus a value ("Attack Speed: 60% of base"),
  // a list ("AoE, Melee, Strike") or a place ("Halls of the Dead - Ngamahu's Test").
  // The parts are translated separately, so only data that exists in the translation
  // tables is used.
  function translateComposedStatText(normalizedEnglish) {
    if (
      !normalizedEnglish.includes(": ") &&
      !normalizedEnglish.includes(", ") &&
      !normalizedEnglish.includes(DASH_SEPARATOR)
    ) {
      return undefined;
    }
    if (composedTranslationCache.has(normalizedEnglish)) {
      return composedTranslationCache.get(normalizedEnglish);
    }
    let translated;
    const separatorIndex = normalizedEnglish.indexOf(": ");
    if (separatorIndex > 0) {
      const rawLabel = normalizedEnglish.slice(0, separatorIndex);
      // "Requires:" keeps its colon in the data ("Requires: " -> "요구 사항: ").
      const label =
        translateStatPart(rawLabel) ?? translateStatPart(`${rawLabel}:`);
      const value = translateStatPart(
        normalizedEnglish.slice(separatorIndex + 2),
        true,
      );
      // Some labels already carry the colon ("Requires: " -> "요구 사항: ").
      const separator = label && label.endsWith(":") ? " " : ": ";
      translated = label && value ? `${label}${separator}${value}` : undefined;
    } else if (normalizedEnglish.includes(DASH_SEPARATOR)) {
      // "<area> - <quest>": both sides are proper names from the game data.
      const parts = normalizedEnglish.split(DASH_SEPARATOR);
      const left = translateStatPart(parts[0]);
      const right = translateStatPart(parts.slice(1).join(DASH_SEPARATOR));
      translated = left && right ? `${left}${DASH_SEPARATOR}${right}` : undefined;
    } else {
      translated = translateStatList(normalizedEnglish);
    }
    if (composedTranslationCache.size < MAX_MATCH_CACHE_ENTRIES) {
      composedTranslationCache.set(normalizedEnglish, translated);
    }
    return translated;
  }

  // "9.6m radius · 8s duration" is printed as value spans plus the fragments "m radius ·" and
  // "s duration", so the unit letter is kept and only the word is translated. The Korean word
  // comes from the data ("radius" -> 반경, "proj" -> 투사체, "duration" -> 지속시간).
  function translateCaptionFragment(normalizedEnglish) {
    const match = normalizedEnglish.match(CAPTION_FRAGMENT_PATTERN);
    if (!match) {
      return undefined;
    }
    const word = translations.get(match[2].replace(/\.$/, ""));
    if (!word) {
      return undefined;
    }
    return `${match[1] ? `${match[1]} ` : ""}${word}${match[3] ?? ""}`;
  }
  // A comma or dot separated list of names and values ("Dire Gorget, Absent Amulet",
  // "Fire Damage · 38,150") is translated part by part. A part without data is kept in English
  // (with the spelling of the page), so a randomly generated rare name does not block the known
  // unique item next to it.
  function translateNameList(value, normalizedEnglish) {
    const separator = LIST_SEPARATORS.find((candidate) =>
      normalizedEnglish.includes(candidate),
    );
    if (!separator) {
      return undefined;
    }
    const parts = normalizedEnglish.split(separator);
    const originalParts = value.trim().split(separator);
    const outputParts =
      originalParts.length === parts.length ? originalParts : parts;
    if (
      parts.length < 2 ||
      parts.some(
        (part) =>
          !part ||
          part.length > LIST_PART_MAX_LENGTH ||
          part.split(" ").length > LIST_PART_MAX_WORDS,
      )
    ) {
      return undefined;
    }
    let translatedCount = 0;
    const translatedParts = parts.map((part, index) => {
      const translatedPart =
        translations.get(part) ?? translateStatText(part, false);
      if (!translatedPart) {
        return outputParts[index];
      }
      translatedCount += 1;
      return translatedPart;
    });
    return translatedCount > 0 ? translatedParts.join(separator) : undefined;
  }

  function translateStatList(normalizedEnglish) {
    if (!normalizedEnglish.includes(", ")) {
      return undefined;
    }
    const parts = normalizedEnglish.split(", ");
    if (parts.length < 2) {
      return undefined;
    }
    const translatedParts = parts.map((part) => translateStatPart(part));
    if (translatedParts.some((part) => !part)) {
      return undefined;
    }
    return translatedParts.join(", ");
  }

  function translateStatPart(normalizedEnglish, allowList = false) {
    if (!normalizedEnglish) {
      return undefined;
    }
    const direct =
      translateStatText(normalizedEnglish, false) ??
      translations.get(normalizedEnglish);
    if (direct) {
      return direct;
    }
    if (NUMERIC_VALUE_PATTERN.test(normalizedEnglish)) {
      return formatStatValue(normalizedEnglish);
    }
    return allowList ? translateStatList(normalizedEnglish) : undefined;
  }

  function translateEnglishText(value) {
    const normalized = normalizeEnglish(value);
    const exactTranslation = translations.get(normalized);
    if (exactTranslation) {
      return exactTranslation;
    }

    // "9.6m radius · 8s duration": the unit letter stays, "radius" becomes 반경.
    const captionTranslation = translateCaptionFragment(normalized);
    if (captionTranslation) {
      return captionTranslation;
    }

    // A label is often printed with a colon ("Support Gem Requirements:", "Category:")
    // while the data holds the bare term, so the colon form is looked up separately.
    if (normalized.endsWith(":")) {
      const withoutColon = normalized.slice(0, -1).trim();
      const label =
        translations.get(withoutColon) ?? translateStatText(withoutColon, false);
      if (label) {
        return `${label}:`;
      }
    }

    const statTranslation = translateStatText(normalized);
    if (statTranslation) {
      return statTranslation;
    }

    const composedTranslation = translateComposedStatText(normalized);
    if (composedTranslation) {
      return composedTranslation;
    }

    const nameListTranslation = translateNameList(value, normalized);
    if (nameListTranslation) {
      return nameListTranslation;
    }

    for (const template of translationTemplates) {
      const match = normalized.match(template.pattern);
      if (!match) {
        continue;
      }
      // The captured value is a name that has its own translation ("Spectre: {0}") most of
      // the time, but a template may also capture a plain number ("Converted from Physical
      // ({0}%)"), which no dictionary holds — such a value is used as it is.
      const captured = normalizeEnglish(match[1]);
      const variableTranslation =
        translations.get(captured) ??
        (NUMERIC_VALUE_PATTERN.test(captured)
          ? formatStatValue(match[1])
          : undefined);
      if (variableTranslation) {
        return (
          template.koreanPrefix +
          variableTranslation +
          template.koreanSuffix
        );
      }
    }

    const levelMatch = normalized.match(/^level (\d+) (.+)$/);
    if (levelMatch) {
      const classTranslation = translations.get(
        normalizeEnglish(levelMatch[2]),
      );
      if (classTranslation) {
        return `레벨 ${levelMatch[1]} ${classTranslation}`;
      }
    }

    const relativeTimeMatch = normalized.match(
      /^(\d+) (minute|hour|day)s? ago$/,
    );
    if (relativeTimeMatch) {
      const unit = {
        minute: "분",
        hour: "시간",
        day: "일",
      }[relativeTimeMatch[2]];
      return `${relativeTimeMatch[1]}${unit} 전`;
    }

    return undefined;
  }

  function isProtectedTableContent(element) {
    if (
      !location.pathname.startsWith("/poe2/builds") ||
      location.pathname.includes("/character/")
    ) {
      return false;
    }
    if (element.closest("[role='grid'], [role='row']")) {
      return true;
    }
    return Boolean(
      element.closest("table") && !element.closest("thead th"),
    );
  }

  // poe.ninja prints a damage multiplier row as `<span>more</span><span>×2.5</span>`, while the
  // bare word is the navigation label "More" (더 보기) elsewhere on the page. Only that row is
  // translated as 증폭, so the nav label stays intact.
  function translateMultiplierLabel(element, trimmed) {
    if (!element || normalizeEnglish(trimmed) !== "more") {
      return undefined;
    }
    const value = element.nextElementSibling?.textContent?.trim() ?? "";
    return /^[×x]\s*\d[\d.,]*$/.test(value) ? "증폭" : undefined;
  }

  function translateTextNode(node) {
    if (
      !translationEnabled ||
      !translationsReady ||
      !node.parentElement ||
      isProtectedTableContent(node.parentElement)
    ) {
      return;
    }
    const original = node.nodeValue;
    const trimmed = original.trim();
    if (!trimmed || KOREAN_REGEX.test(trimmed)) {
      return;
    }
    const translated =
      translateMultiplierLabel(node.parentElement, trimmed) ??
      translateEnglishText(trimmed);
    if (!translated || translated === trimmed) {
      if (!aliasesLoaded) {
        pendingTextNodes.add(node);
      }
      return;
    }
    const start = original.indexOf(trimmed);
    if (!originalTextByNode.has(node)) {
      originalTextByNode.set(node, original);
    }
    node.nodeValue =
      original.slice(0, start) + translated + original.slice(start + trimmed.length);
  }

  function translateElement(element) {
    if (
      !translationEnabled ||
      !(element instanceof Element) ||
      isProtectedTableContent(element)
    ) {
      return;
    }
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      const original = element.getAttribute(attribute);
      if (!original || KOREAN_REGEX.test(original)) {
        continue;
      }
      const translated = translateEnglishText(original.trim());
      if (translated) {
        let attributes = originalAttributesByElement.get(element);
        if (!attributes) {
          attributes = new Map();
          originalAttributesByElement.set(element, attributes);
        }
        if (!attributes.has(attribute)) {
          attributes.set(attribute, original);
        }
        element.setAttribute(attribute, translated);
      } else if (!aliasesLoaded) {
        pendingAttributeElements.add(element);
      }
    }
  }

  function textNodesOf(element) {
    const nodes = [];
    const collect = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          nodes.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          collect(child);
        }
      }
    };
    collect(element);
    return nodes;
  }

  // poe.ninja renders one attribute line as several <span>s: the value stays in
  // a plain <span> while the keywords inside the line are tooltip triggers, e.g.
  //   <div><span>30% increased </span><span>Charm</span><span> Charges gained</span></div>
  // Joining them allows the trade API templates to match the whole line.
  function translateStatLine(element) {
    if (
      !translationEnabled ||
      !translationsReady ||
      statTemplates.length === 0 ||
      !(element instanceof Element) ||
      isProtectedTableContent(element)
    ) {
      return;
    }
    const children = [...element.children];
    if (
      children.length < 2 ||
      !children.every((child) => child.tagName === "SPAN") ||
      // A line is made of inline spans only; anything else (a card with several
      // lines, links, images) is left to the normal text node translation.
      [...element.querySelectorAll("*")].some((node) => node.tagName !== "SPAN")
    ) {
      return;
    }
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        return;
      }
    }
    const trimmed = (element.textContent ?? "").trim();
    // The English text is rebuilt from the remembered originals, because the keyword
    // spans inside the line may already have been translated one by one, which would mix
    // English and Korean ("...that deals 카오스 damage over time...") in textContent.
    const nodes = textNodesOf(element);
    if (nodes.length === 0) {
      return;
    }
    const english = nodes
      .map((node) => originalTextByNode.get(node) ?? node.nodeValue ?? "")
      .join("")
      .trim();
    // Value free lines ("Gem Quality grants Socketed Skills an additional effect") are
    // split into keyword spans too, so lines without a digit are joined as well: the digit
    // requirement lives inside the template lookup of translateEnglishText, which returns
    // undefined when nothing matches. Skill descriptions can be several hundred
    // characters long, hence the generous length limit.
    if (
      !english ||
      english.length > MAX_STAT_LINE_LENGTH ||
      KOREAN_REGEX.test(english)
    ) {
      return;
    }
    const translated = translateEnglishText(english);
    if (!translated || translated === english) {
      return;
    }
    // poe.ninja marks the keywords of a line with `data-tooltip-trigger`; putting the Korean
    // line back into the same spans keeps those hover tooltips working.
    if (distributeTranslatedLine(element, translated)) {
      return;
    }
    // The whole line goes into the first text node and the other nodes are
    // emptied, so no English fragment is left behind next to the translation.
    for (const node of nodes) {
      if (!originalTextByNode.has(node)) {
        originalTextByNode.set(node, node.nodeValue);
      }
    }
    nodes[0].nodeValue = translated;
    for (let index = 1; index < nodes.length; index += 1) {
      nodes[index].nodeValue = "";
    }
  }

  // The line uses another grammatical form and spelling than the term table ("Slowing" in the
  // line against "Slow" -> 감속 in the buff data, "Channel" against "Channelling" -> 집중 유지
  // in the keyword data), so every known form contributes a candidate Korean word and the one
  // that is actually printed in the translated line wins.
  function keywordCandidates(text) {
    const key = normalizeEnglish(text);
    if (!key) {
      return [];
    }
    const forms = new Set([key]);
    if (key.endsWith("s")) {
      forms.add(key.slice(0, -1));
      forms.add(key.slice(0, -2));
    } else if (key.endsWith("ing")) {
      const stem = key.slice(0, -3);
      forms.add(stem);
      forms.add(`${stem}e`);
    } else if (key.endsWith("ed")) {
      const stem = key.slice(0, -2);
      forms.add(stem);
      forms.add(`${stem}e`);
    } else {
      const lastChar = key.slice(-1);
      forms.add(`${key}s`);
      forms.add(`${key}ing`);
      if (/[a-z]/.test(lastChar) && !"aeiou".includes(lastChar)) {
        // "channel" -> "channelling" (the game spells it with a doubled consonant).
        forms.add(`${key}${lastChar}ing`);
      }
      if (key.endsWith("e")) {
        forms.add(`${key.slice(0, -1)}ing`);
      }
      if (key.endsWith("y")) {
        forms.add(`${key.slice(0, -1)}ies`);
      }
    }
    const candidates = [];
    for (const form of forms) {
      const korean = translations.get(form);
      if (
        typeof korean === "string" &&
        korean &&
        KOREAN_REGEX.test(korean) &&
        korean !== text.trim() &&
        !candidates.includes(korean)
      ) {
        candidates.push(korean);
      }
    }
    return candidates;
  }

  // Looks for a keyword inside the Korean line. The full term is preferred over its first word
  // when both start at the same place, otherwise the earliest match wins, so that a term which
  // is printed in an inflected form ("집중 유지" as "집중을 유지하여") does not steal the match
  // of the next occurrence.
  function findKeywordInLine(candidates, translated, from) {
    let best;
    const consider = (text, at) => {
      if (at >= 0 && (!best || at < best.at)) {
        best = { at, text };
      }
    };
    for (const candidate of candidates) {
      consider(candidate, translated.indexOf(candidate, from));
    }
    for (const candidate of candidates) {
      const token = candidate.split(" ")[0];
      if (token && token !== candidate) {
        consider(token, translated.indexOf(token, from));
      }
    }
    return best;
  }

  // poe.ninja marks the keywords of a line with `data-tooltip-trigger` and underlines them.
  // Writing the whole translation into the first span would empty those spans and kill
  // their tooltips, so the Korean line is put back into the original spans: each keyword
  // span receives the Korean word that replaced its English word, the surrounding text
  // stays in the plain spans. Returns false when the line has no keyword to anchor.
  function distributeTranslatedLine(element, translated) {
    const entries = [...element.children].map((span) => {
      const original = textNodesOf(span)
        .map((node) => originalTextByNode.get(node) ?? node.nodeValue ?? "")
        .join("");
      // Whenever the span has its own Korean word it can be anchored, no matter whether the
      // page marked it as a tooltip trigger.
      return { span, candidates: keywordCandidates(original) };
    });
    if (!entries.some((entry) => entry.candidates.length > 0)) {
      return false;
    }
    const replacements = new Map();
    let cursor = 0;
    let gapTarget = null;
    for (const entry of entries) {
      if (entry.candidates.length > 0) {
        const found = findKeywordInLine(entry.candidates, translated, cursor);
        if (found) {
          if (gapTarget) {
            replacements.set(
              gapTarget,
              (replacements.get(gapTarget) ?? "") + translated.slice(cursor, found.at),
            );
          }
          replacements.set(entry.span, found.text);
          cursor = found.at + found.text.length;
        }
        // Not found in the Korean line (another wording): the span stays empty and its
        // text remains part of the surrounding text.
        gapTarget = null;
        continue;
      }
      if (!gapTarget) {
        gapTarget = entry.span;
      }
    }
    const tail = translated.slice(cursor);
    if (tail) {
      const target = gapTarget ?? entries[entries.length - 1].span;
      replacements.set(target, (replacements.get(target) ?? "") + tail);
    }
    for (const node of textNodesOf(element)) {
      if (!originalTextByNode.has(node)) {
        originalTextByNode.set(node, node.nodeValue);
      }
    }
    for (const entry of entries) {
      const text = replacements.get(entry.span) ?? "";
      const spanNodes = textNodesOf(entry.span);
      if (spanNodes.length === 0) {
        // An empty span ("<span></span>" in front of the line) needs a text node before the
        // text that belongs there can be written; its English original is empty.
        if (!text) {
          continue;
        }
        const node = document.createTextNode(text);
        entry.span.appendChild(node);
        originalTextByNode.set(node, "");
        continue;
      }
      spanNodes[0].nodeValue = text;
      for (let index = 1; index < spanNodes.length; index += 1) {
        spanNodes[index].nodeValue = "";
      }
    }
    return true;
  }

  function translateSubtree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    translateElement(root);
    translateStatLine(root);
    const walker = document.createTreeWalker(
      root,
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
        translateTextNode(node);
      } else {
        translateElement(node);
        translateStatLine(node);
      }
    }
  }

  function scheduleSubtreeFlush() {
    if (subtreeFlushScheduled || !translationsReady) {
      return;
    }
    subtreeFlushScheduled = true;
    requestAnimationFrame(() => {
      subtreeFlushScheduled = false;
      const roots = [...pendingSubtrees];
      pendingSubtrees.clear();
      for (const root of roots) {
        if (root.isConnected) {
          translateSubtree(root);
        }
      }
    });
  }

  function queueSubtree(node) {
    if (!translationsReady) {
      return;
    }
    for (const pending of pendingSubtrees) {
      if (pending === node || pending.contains?.(node)) {
        return;
      }
      if (node.contains?.(pending)) {
        pendingSubtrees.delete(pending);
      }
    }
    pendingSubtrees.add(node);
    scheduleSubtreeFlush();
  }

  function observePage() {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    if (observer) {
      return;
    }
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            queueSubtree(node);
          }
        } else if (mutation.type === "characterData") {
          queueSubtree(mutation.target);
        } else if (mutation.type === "attributes") {
          translateElement(mutation.target);
        }
      }
    });
    observer.observe(root, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
      subtree: true,
    });
  }

  function restoreOriginalText() {
    for (const [node, text] of originalTextByNode) {
      if (node.isConnected) {
        node.nodeValue = text;
      } else {
        originalTextByNode.delete(node);
      }
    }
    for (const [element, attributes] of originalAttributesByElement) {
      if (!element.isConnected) {
        originalAttributesByElement.delete(element);
        continue;
      }
      for (const [attribute, value] of attributes) {
        element.setAttribute(attribute, value);
      }
    }
  }

  function setTranslationEnabled(enabled) {
    if (translationEnabled === enabled) {
      return;
    }
    translationEnabled = enabled;
    if (enabled) {
      const root = document.documentElement;
      if (root) {
        translateSubtree(root);
      }
    } else {
      restoreOriginalText();
    }
    updateUi();
  }

  const UI_HOST_ID = "poe-ninja-korean-ui";
  let uiParts = null;

  function buildUi() {
    if (uiParts || !document.body || document.getElementById(UI_HOST_ID)) {
      return;
    }
    const host = document.createElement("div");
    host.id = UI_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; font: 12px/1.45 Arial, "Malgun Gothic", sans-serif; color: #e8e4dc; }
      button { border: 1px solid #716548; border-radius: 6px; background: #1a1c22; color: inherit; font: inherit; padding: 6px 10px; cursor: pointer; }
      button[data-active="true"] { background: #dfbd68; border-color: #dfbd68; color: #1a1c22; }
    `;

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.append(toggleButton);
    shadow.append(style, wrap);
    document.body.append(host);

    uiParts = { toggleButton };

    toggleButton.addEventListener("click", () =>
      setTranslationEnabled(!translationEnabled),
    );
    updateUi();
  }

  function updateUi() {
    if (!uiParts) {
      return;
    }
    uiParts.toggleButton.textContent = translationEnabled ? "한" : "영";
    uiParts.toggleButton.dataset.active = String(translationEnabled);
    uiParts.toggleButton.title = translationEnabled
      ? "한글로 표시 중 — 클릭하면 영문 원문"
      : "영문 원문 표시 중 — 클릭하면 한글";
  }

  function initUi() {
    if (document.body) {
      buildUi();
      return;
    }
    document.addEventListener("DOMContentLoaded", buildUi, { once: true });
  }

  async function loadTranslations() {
    const interfaceTranslations = await requestJson(INTERFACE_DATA_FILE);
    addObjectTranslations(interfaceTranslations);

    const manualDataFiles = [KEYWORD_DATA_FILE, CUSTOM_DATA_FILE];
    const [payloads, statLinePayloads, manualPayloads, optionalCorePayloads] =
      await Promise.all([
      Promise.all(CORE_DATA_FILES.map(requestJson)),
      // The item mod and skill gem line data is optional, so a pinned data
      // commit without those files still works.
      Promise.all(
        STAT_LINE_DATA_FILES.map((fileName) =>
          requestJson(fileName).catch((error) => {
            console.info(PREFIX, `${fileName} 로드 건너뜀`, error.message);
            return null;
          }),
        ),
      ),
      // The curated and manual files are optional as well, so a pinned data commit that
      // predates them does not stop the extension from loading.
      Promise.all(
        manualDataFiles.map((fileName) =>
          requestJson(fileName).catch((error) => {
            console.info(PREFIX, `${fileName} 로드 건너뜀`, error.message);
            return null;
          }),
        ),
      ),
      // 같은 이유로 선택적인 코어 파일(mods.json)도 실패를 무시한다.
      Promise.all(
        OPTIONAL_CORE_DATA_FILES.map((fileName) =>
          requestJson(fileName).catch((error) => {
            console.info(PREFIX, `${fileName} 로드 건너뜀`, error.message);
            return null;
          }),
        ),
      ),
    ]);
    const corePayloads = new Map(
      CORE_DATA_FILES.map((fileName, index) => [fileName, payloads[index]]),
    );
    const payloadByFile = new Map(
      manualDataFiles.map((fileName, index) => [fileName, manualPayloads[index]]),
    );
    for (const fileName of CORE_DATA_FILES) {
      const payload = corePayloads.get(fileName);
      if (Array.isArray(payload)) {
        addRows(payload);
      } else {
        addObjectTranslations(payload);
      }
    }
    registerBaseItemTypes(corePayloads.get("items/base_items.json"));
    registerUniqueItems(corePayloads.get("items/unique_items.json"));
    for (const payload of optionalCorePayloads) {
      if (Array.isArray(payload)) {
        addRows(payload);
      } else {
        addObjectTranslations(payload);
      }
    }
    for (const statLinePayload of statLinePayloads) {
      addStatRows(statLinePayload);
    }
    // keyword.json overrides the harvested data, custom.json overrides everything.
    addCustomTranslations(payloadByFile.get(KEYWORD_DATA_FILE));
    addCustomTranslations(payloadByFile.get(CUSTOM_DATA_FILE));
    aliasesLoaded = true;
    koreanSearchCache.clear();
    translationsReady = true;
    const root = document.documentElement;
    if (root) {
      translateSubtree(root);
    }
    pendingSubtrees.clear();
    scheduleSubtreeFlush();
    for (const node of pendingTextNodes) {
      if (node.isConnected) {
        translateTextNode(node);
      }
    }
    pendingTextNodes.clear();
    for (const element of pendingAttributeElements) {
      if (element.isConnected) {
        translateElement(element);
      }
    }
    pendingAttributeElements.clear();
    if (typeof globalThis.chrome?.runtime?.getURL === "function") {
      // page_search.js runs in the page world: it needs the search aliases,
      // the unique item names for the 고유 keyword, and the item class map.
      window.postMessage(
        {
          source: "poe-ninja-korean-translation",
          type: "aliases",
          entries: [...englishAliases].map(([english, korean]) => [
            english,
            [...korean],
          ]),
          uniqueNames: [...uniqueItemNames],
          labels: [...koreanLabelByEnglish],
          itemClassUniqueItems: [...uniqueItemIdsByItemClass],
        },
        location.origin,
      );
    }
    console.info(PREFIX, "번역 및 검색 데이터 로드 완료", {
      검색대상수: englishAliases.size,
      화면번역수: translations.size,
      속성번역수: statTemplates.length,
      고유아이템수: uniqueItemNames.size,
      아이템분류수: uniqueItemIdsByItemClass.size,
    });
  }

  installKoreanSearch();
  initUi();
  // Debug aid for the devtools console (the content script world is otherwise
  // not reachable): __poeNinjaKoreanTranslation.translate("Level: (1—20)").
  globalThis.__poeNinjaKoreanTranslation = {
    translate: (text) => translateEnglishText(text),
    normalized: (text) => translateStatText(normalizeEnglish(text)),
    ready: () => translationsReady,
    counts: () => ({
      검색대상수: englishAliases.size,
      화면번역수: translations.size,
      속성번역수: statTemplates.length,
    }),
  };
  if (document.documentElement) {
    observePage();
  } else {
    document.addEventListener("DOMContentLoaded", observePage, { once: true });
  }

  loadTranslations().catch((error) => {
    console.error(PREFIX, "번역 데이터 로드 실패", error);
  });
})();
