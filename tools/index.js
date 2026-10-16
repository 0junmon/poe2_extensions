const DATA_FILES = [
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
];

function normalizeText(value) {
  return value.trim().toLocaleLowerCase("en");
}

function validateRows(rows, name, allowMissingTable = false) {
  if (!Array.isArray(rows)) {
    throw new TypeError(`${name} must be an array of translation records`);
  }
  for (const [index, row] of rows.entries()) {
    if (
      row === null ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      typeof row.ko !== "string" ||
      (row.table === undefined && !allowMissingTable) ||
      (row.table !== undefined && typeof row.table !== "string")
    ) {
      throw new TypeError(
        `${name}[${index}] must contain string id and ko fields, and an optional string table field`,
      );
    }
  }
}

function withDefaultTable(rows, table) {
  return rows.map((row) =>
    row.table === undefined ? { ...row, table } : row,
  );
}

function customRows(custom) {
  if (Array.isArray(custom)) {
    validateRows(custom, "custom", true);
    return withDefaultTable(custom, "custom");
  }
  if (custom === undefined || custom === null) {
    return [];
  }
  if (typeof custom !== "object") {
    throw new TypeError("custom must be an array or an object of id-to-Korean strings");
  }
  return Object.entries(custom).map(([id, ko]) => {
    if (typeof ko !== "string") {
      throw new TypeError(`custom.${id} must be a Korean translation string`);
    }
    return { id, ko, table: "custom" };
  });
}

// itemclasscategories.json is a plain {"<id>": "<Korean>"} map; older data used an
// array of {id, ko} rows.
function categoryRows(categories) {
  if (categories === undefined || categories === null) {
    return [];
  }
  if (Array.isArray(categories)) {
    return categories;
  }
  if (typeof categories !== "object") {
    return categories;
  }
  return Object.entries(categories).map(([id, ko]) => {
    if (typeof ko !== "string") {
      throw new TypeError(
        `itemclasscategories.${id} must be a Korean translation string`,
      );
    }
    return { id, ko };
  });
}

function indexRows(rows, field) {
  const index = new Map();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    const key = normalizeText(value);
    const matches = index.get(key) ?? [];
    matches.push(row);
    index.set(key, matches);
  }
  return index;
}

function getMatches(index, value, table) {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  const matches = index.get(normalizeText(value)) ?? [];
  return table ? matches.filter((row) => row.table === table) : [...matches];
}

function categoryForItemClass(itemClass, categoriesById) {
  return categoriesById.get(normalizeText(itemClass)) ?? null;
}

export function createTranslator(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object containing translation arrays");
  }

  const compact = data.compact ?? [];
  const words = data.words ?? [];
  const baseitemtypes = data.baseitemtypes ?? [];
  const itemclasscategories = categoryRows(data.itemclasscategories);
  const uniqueitems = data.uniqueitems ?? [];
  const classes = data.classes ?? [];
  validateRows(compact, "compact");
  for (const [name, rows] of Object.entries({
    compact,
    words,
    baseitemtypes,
    itemclasscategories,
    uniqueitems,
    classes,
  })) {
    if (name !== "compact") {
      validateRows(rows, name, true);
    }
  }

  const sourceRows = [
    ...compact,
    ...words,
    ...baseitemtypes,
    ...itemclasscategories,
    ...uniqueitems,
    ...classes,
  ];
  const custom = customRows(data.custom);
  const customIds = new Set(custom.map((row) => normalizeText(row.id)));
  const rows = [
    ...sourceRows.filter((row) => !customIds.has(normalizeText(row.id))),
    ...custom,
  ];
  const englishIndex = indexRows(rows, "id");
  const koreanIndex = indexRows(rows, "ko");
  const baseItemsById = new Map(
    baseitemtypes.map((item) => [normalizeText(item.id), item]),
  );
  const categoriesById = new Map(
    itemclasscategories.map((category) => [
      normalizeText(category.id),
      category,
    ]),
  );
  const uniqueItemsByBase = new Map();
  for (const unique of uniqueitems) {
    if (typeof unique.baseItem !== "string") {
      continue;
    }
    const key = normalizeText(unique.baseItem);
    const matches = uniqueItemsByBase.get(key) ?? [];
    matches.push(unique);
    uniqueItemsByBase.set(key, matches);
  }

  function enrich(row) {
    const result = { ...row };
    if (row.table === "uniqueitems" && typeof row.baseItem === "string") {
      const baseItem = baseItemsById.get(normalizeText(row.baseItem));
      if (baseItem) {
        result.baseItemRecord = { ...baseItem };
        const itemClassId = baseItem.itemClassId ?? baseItem.itemClass;
        if (typeof itemClassId === "string") {
          const category = categoryForItemClass(
            itemClassId,
            categoriesById,
          );
          if (category) {
            result.itemClassRecord = { ...category };
          }
        }
      }
    }
    if (
      row.table === "baseitemtypes" &&
      typeof (row.itemClassId ?? row.itemClass) === "string"
    ) {
      const category = categoryForItemClass(
        row.itemClassId ?? row.itemClass,
        categoriesById,
      );
      if (category) {
        result.itemClassRecord = { ...category };
      }
    }
    return result;
  }

  function translate(text, options = {}) {
    return getMatches(englishIndex, text, options.table).map(enrich);
  }

  function reverseTranslate(text, options = {}) {
    return getMatches(koreanIndex, text, options.table).map(enrich);
  }

  function searchKorean(text, options = {}) {
    if (typeof text !== "string" || text.trim() === "") {
      return [];
    }
    const query = normalizeText(text);
    return rows
      .filter(
        (row) =>
          typeof row.ko === "string" &&
          normalizeText(row.ko).includes(query) &&
          (!options.table || row.table === options.table),
      )
      .map(enrich);
  }

  function findRelatedUniqueItems(text, options = {}) {
    const categoryMatches =
      options.language === "en"
        ? getMatches(englishIndex, text, "itemclasscategories")
        : getMatches(koreanIndex, text, "itemclasscategories");
    const result = [];
    const seen = new Set();
    for (const category of categoryMatches) {
      for (const baseItem of baseitemtypes) {
        if (
          normalizeText(baseItem.itemClassId ?? baseItem.itemClass ?? "") !==
          normalizeText(category.id)
        ) {
          continue;
        }
        for (const unique of uniqueItemsByBase.get(normalizeText(baseItem.id)) ?? []) {
          const uniqueKey = `${normalizeText(unique.id)}\0${normalizeText(
            unique.baseItem,
          )}`;
          if (seen.has(uniqueKey)) {
            continue;
          }
          seen.add(uniqueKey);
          result.push(enrich(unique));
        }
      }
    }
    return result;
  }

  function search(text, options = {}) {
    const directMatches =
      options.language === "ko"
        ? reverseTranslate(text, { table: options.table })
        : translate(text, { table: options.table });
    return {
      matches: directMatches,
      relatedUniqueItems:
        options.table && options.table !== "itemclasscategories"
          ? []
          : findRelatedUniqueItems(text, { language: options.language }),
    };
  }

  return {
    translate,
    reverseTranslate,
    searchKorean,
    findRelatedUniqueItems,
    search,
  };
}

export async function loadTranslator(baseUrl, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required to load translation files");
  }
  if (typeof baseUrl !== "string" && !(baseUrl instanceof URL)) {
    throw new TypeError("baseUrl must be a string or URL");
  }

  const base = new URL(
    baseUrl instanceof URL ? baseUrl.href : `${baseUrl.replace(/\/?$/, "/")}`,
  );
  const payloads = await Promise.all(
    DATA_FILES.map(async (fileName) => {
      const response = await fetchImpl(new URL(fileName, base));
      if (!response.ok) {
        throw new Error(
          `Failed to load ${fileName}: HTTP ${response.status} ${response.statusText}`,
        );
      }
      return response.json();
    }),
  );
  const [
    compact,
    words,
    baseitemtypes,
    itemclasscategories,
    uniqueitems,
    classes,
    keyword,
    custom,
  ] = payloads;
  return createTranslator({
    compact,
    words,
    baseitemtypes,
    itemclasscategories,
    uniqueitems,
    classes,
    // keyword.json is the curated term table, custom.json the manual override on top of it.
    custom: [
      ...(Array.isArray(keyword) ? keyword : []),
      ...(Array.isArray(custom) ? custom : []),
    ],
  });
}
