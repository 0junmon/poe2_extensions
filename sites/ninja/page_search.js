(() => {
  "use strict";

  const KOREAN_REGEX = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
  // Only "고유" is a keyword, and a partial input (고, 유, 고유) is enough.
  const UNIQUE_SEARCH_KEYWORD = "고유";
  const FILTER_SEARCH_INPUT_SELECTOR = [
    'input[placeholder="Search filters..."]',
    'input[placeholder="필터 검색..."]',
  ].join(", ");
  const SEARCH_LOG_SETTING = "poe-ninja-korean-search-log";
  const MAX_MATCH_CACHE_ENTRIES = 20000;
  const originalIndexOf = String.prototype.indexOf;
  const originalIncludes = String.prototype.includes;
  const koreanSearchCache = new Map();
  const englishNameMatchCache = new Map();
  const englishAliases = new Map();
  const uniqueItemNames = new Set();
  const uniqueItemIdsByItemClass = new Map();
  let aliasesLoaded = false;
  let searchLogEnabled = readSearchLogEnabled();

  function readSearchLogEnabled() {
    try {
      const stored = window.localStorage?.getItem(SEARCH_LOG_SETTING);
      return stored !== "0" && stored !== "false";
    } catch (error) {
      return true;
    }
  }

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
  // originalIncludes is used because includes itself is patched below.
  function isUniqueKeywordQuery(normalizedQuery) {
    if (!normalizedQuery) {
      return false;
    }
    return originalIncludes.call(UNIQUE_SEARCH_KEYWORD, normalizedQuery);
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
      if (
        [...koreanNames].some((name) =>
          originalIncludes.call(name, normalizedQuery),
        )
      ) {
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

  function matchesEnglishAlias(target, search) {
    if (
      !aliasesLoaded ||
      typeof search !== "string" ||
      !KOREAN_REGEX.test(search)
    ) {
      return false;
    }
    const normalizedQuery = normalizeKorean(search);
    if (!normalizedQuery) {
      return false;
    }
    const names = getEnglishNamesForKoreanSearch(search);
    if (names.length === 0) {
      return false;
    }
    const normalizedTarget = normalizeEnglish(target);
    const cacheKey = `${normalizedQuery}\u0000${normalizedTarget}`;
    const cached = englishNameMatchCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const matched = names.some((name) =>
      originalIncludes.call(normalizedTarget, name),
    );
    if (englishNameMatchCache.size >= MAX_MATCH_CACHE_ENTRIES) {
      englishNameMatchCache.clear();
    }
    englishNameMatchCache.set(cacheKey, matched);
    return matched;
  }

  function isFilterSearchInput(element) {
    return (
      Boolean(element) &&
      typeof element.matches === "function" &&
      typeof element.value === "string" &&
      element.matches(FILTER_SEARCH_INPUT_SELECTOR)
    );
  }

  function reportKoreanSearch(query) {
    if (
      !searchLogEnabled ||
      typeof query !== "string" ||
      !KOREAN_REGEX.test(query)
    ) {
      return;
    }
    const resolution = resolveKoreanQuery(query);
    if (!resolution.normalizedQuery) {
      return;
    }
    console.info(
      "[poe 닌자 한글 검색]",
      `"${query}" → 영어 id ${resolution.englishNames.length}개 / 아이템 분류 ${resolution.itemClasses.length}개 / 고유 아이템 ${resolution.uniqueItemIds.length}개`,
      {
        영어id: resolution.englishNames,
        아이템분류: resolution.itemClasses,
        고유아이템: resolution.uniqueItemIds,
        고유키워드: resolution.uniqueKeyword,
      },
    );
  }

  document.addEventListener(
    "input",
    (event) => {
      if (isFilterSearchInput(event.target)) {
        reportKoreanSearch(event.target.value);
      }
    },
    true,
  );

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source !== window ||
      message?.source !== "poe-ninja-korean-translation" ||
      message.type !== "aliases" ||
      !Array.isArray(message.entries)
    ) {
      return;
    }
    englishAliases.clear();
    for (const [englishName, koreanNames] of message.entries) {
      if (
        typeof englishName === "string" &&
        Array.isArray(koreanNames) &&
        koreanNames.every((name) => typeof name === "string")
      ) {
        englishAliases.set(normalizeEnglish(englishName), new Set(koreanNames));
      }
    }
    uniqueItemNames.clear();
    if (Array.isArray(message.uniqueNames)) {
      for (const name of message.uniqueNames) {
        if (typeof name === "string" && name) {
          uniqueItemNames.add(normalizeEnglish(name));
        }
      }
    }
    uniqueItemIdsByItemClass.clear();
    if (Array.isArray(message.itemClassUniqueItems)) {
      for (const entry of message.itemClassUniqueItems) {
        if (
          !Array.isArray(entry) ||
          typeof entry[0] !== "string" ||
          !Array.isArray(entry[1])
        ) {
          continue;
        }
        const itemClass = normalizeEnglish(entry[0]);
        const uniqueItemIds = [];
        for (const uniqueItemId of entry[1]) {
          if (typeof uniqueItemId === "string" && uniqueItemId) {
            uniqueItemIds.push(normalizeEnglish(uniqueItemId));
          }
        }
        if (itemClass && uniqueItemIds.length > 0) {
          uniqueItemIdsByItemClass.set(itemClass, uniqueItemIds);
        }
      }
    }
    koreanSearchCache.clear();
    englishNameMatchCache.clear();
    aliasesLoaded = true;

    for (const searchInput of document.querySelectorAll(
      FILTER_SEARCH_INPUT_SELECTOR,
    )) {
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  String.prototype.indexOf = function (search, ...args) {
    if (matchesEnglishAlias(String(this), search)) {
      return 0;
    }
    return originalIndexOf.call(this, search, ...args);
  };

  String.prototype.includes = function (search, ...args) {
    if (matchesEnglishAlias(String(this), search)) {
      return true;
    }
    return originalIncludes.call(this, search, ...args);
  };

  // Exposed for korean-search.html and for manual checks in the devtools console.
  globalThis.__poeNinjaKoreanSearch = {
    resolveKoreanQuery,
    getEnglishNamesForKoreanSearch,
    matchesEnglishAlias,
    isLoaded: () => aliasesLoaded,
  };
})();
