import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./project-root.mjs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadSearchPayload } from "../search-payload.js";

const projectRoot = resolveProjectRoot(import.meta.url);
const translationDirectory = path.join(projectRoot, "translations");
const SEARCH_LOG_PREFIX = "[poe 닌자 한글 검색]";

const pageSearchSource = await readFile(
  path.join(projectRoot, "chrome-extension", "page_search.js"),
  "utf8",
);
const contentScriptSource = await readFile(
  path.join(projectRoot, "userscripts", "poe-ninja-translation.user.js"),
  "utf8",
);

const readTranslations = (fileName) =>
  JSON.parse(readFileSync(path.join(translationDirectory, fileName), "utf8"));

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

function createLogRecorder() {
  const entries = [];
  const record =
    (level) =>
    (...args) => {
      entries.push({ level, args });
    };
  return {
    entries,
    console: {
      log: record("log"),
      info: record("info"),
      debug: record("debug"),
      warn: record("warn"),
      error: record("error"),
    },
  };
}

async function waitFor(predicate, timeoutMs = 20000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out while waiting for the translation data to load");
}

function createContentScriptWorld() {
  const log = createLogRecorder();
  const posted = [];
  const windowObject = {
    postMessage(message) {
      posted.push(message);
    },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
  };
  const documentObject = {
    documentElement: null,
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    location: {
      origin: "https://poe.ninja",
      href: "https://poe.ninja/poe2/builds/forbiddenrites",
    },
    console: log.console,
    chrome: {
      runtime: { getURL: (resource) => `https://extension.test/${resource}` },
    },
    fetch: async (url) => {
      const fileName = String(url).replace(/^https?:\/\/[^/]+\//, "");
      const payload = JSON.parse(
        await readFile(path.join(projectRoot, fileName), "utf8"),
      );
      return { ok: true, status: 200, json: async () => payload };
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(contentScriptSource, context, {
    filename: "poe-ninja-translation.user.js",
  });
  return { posted, log };
}

function createPageWorld({ localStorageValue = null, filterInputs = [] } = {}) {
  const log = createLogRecorder();
  const messageHandlers = [];
  const inputHandlers = [];
  const windowObject = {
    localStorage: { getItem: () => localStorageValue, setItem() {} },
    addEventListener(type, handler) {
      if (type === "message") {
        messageHandlers.push(handler);
      }
    },
  };
  const documentObject = {
    documentElement: null,
    addEventListener(type, handler) {
      if (type === "input") {
        inputHandlers.push(handler);
      }
    },
    querySelectorAll: () => filterInputs,
    querySelector: () => null,
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    location: {
      origin: "https://poe.ninja",
      href: "https://poe.ninja/poe2/builds/forbiddenrites",
    },
    console: log.console,
    Event: class TestEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(pageSearchSource, context, { filename: "page_search.js" });

  const dispatchAliases = (payload) => {
    for (const handler of messageHandlers) {
      handler({ source: windowObject, data: payload });
    }
  };
  const typeFilterQuery = (value) => {
    for (const handler of inputHandlers) {
      handler({ target: { value, matches: () => true } });
    }
  };
  const indexOf = (target, query) =>
    vm.runInContext(
      `(${JSON.stringify(target)}).indexOf(${JSON.stringify(query)})`,
      context,
    );
  const includes = (target, query) =>
    vm.runInContext(
      `(${JSON.stringify(target)}).includes(${JSON.stringify(query)})`,
      context,
    );
  const koreanReports = () =>
    log.entries.filter(
      (entry) => entry.level === "info" && entry.args[0] === SEARCH_LOG_PREFIX,
    );
  return {
    dispatchAliases,
    typeFilterQuery,
    indexOf,
    includes,
    koreanReports,
    lastReport: () => koreanReports().at(-1)?.args[2],
    log,
  };
}

const contentWorld = createContentScriptWorld();
await waitFor(() => contentWorld.posted.length > 0);
const aliasesPayload = contentWorld.posted.at(-1);

const uniqueItems = readTranslations("items/unique_items.json");
const baseItemTypes = readTranslations("items/base_items.json");
const itemClassCategories = readTranslations("items/item_classes.json");
const categoryKorean = (id) =>
  Array.isArray(itemClassCategories)
    ? itemClassCategories.find((row) => row.id === id)?.ko
    : itemClassCategories[id];
const itemClassByBaseItemId = new Map(
  baseItemTypes.map((row) => [row.id, row.itemClass]),
);

test("content script publishes unique names and per class unique items", () => {
  assert.equal(aliasesPayload.source, "poe-ninja-korean-translation");
  assert.equal(aliasesPayload.type, "aliases");
  assert.ok(
    aliasesPayload.entries.length > 1000,
    `expected many aliases, got ${aliasesPayload.entries.length}`,
  );
  assert.equal(aliasesPayload.uniqueNames.length, uniqueItems.length);

  const uniqueItemIdsByItemClass = new Map(aliasesPayload.itemClassUniqueItems);
  const expectedByItemClass = new Map();
  for (const row of uniqueItems) {
    const itemClass = itemClassByBaseItemId.get(row.baseItem);
    if (!itemClass) {
      continue;
    }
    const itemClassKey = normalizeEnglish(itemClass);
    const ids = expectedByItemClass.get(itemClassKey) ?? [];
    ids.push(normalizeEnglish(row.id));
    expectedByItemClass.set(itemClassKey, ids);
  }
  assert.deepEqual(
    [...uniqueItemIdsByItemClass.keys()].sort(),
    [...expectedByItemClass.keys()].sort(),
  );
  assert.deepEqual(
    [...uniqueItemIdsByItemClass.get("shield")].sort(),
    expectedByItemClass.get("shield").sort(),
  );
  assert.ok(uniqueItemIdsByItemClass.get("shield").includes("alkem eira"));

  // only unique item ids are used for the class expansion, never base items
  const uniqueNames = new Set(uniqueItems.map((row) => normalizeEnglish(row.id)));
  for (const [, ids] of uniqueItemIdsByItemClass) {
    assert.ok(ids.every((id) => uniqueNames.has(id)));
  }
});

test("고유 keyword matches every unique item from uniqueitems.json", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);

  const missed = uniqueItems.filter(
    (row) =>
      pageWorld.indexOf(row.id, "고유") !== 0 ||
      pageWorld.indexOf(`Unique ${row.id}`, "고유") !== 0,
  );
  assert.deepEqual(
    missed.map((row) => row.id),
    [],
  );

  const uniqueNames = aliasesPayload.uniqueNames;
  const nonUniqueTargets = [
    "Rare Ring",
    "Rare Jewel",
    "Rare Body Armour",
    "Herald of Ice",
    "Spear",
  ].filter((target) => {
    const normalized = normalizeEnglish(target);
    return !uniqueNames.some((name) => normalized.includes(name));
  });
  assert.ok(nonUniqueTargets.length > 0);
  for (const target of nonUniqueTargets) {
    assert.equal(pageWorld.indexOf(target, "고유"), -1, target);
  }
});

test("고유 keyword is recognised with partial input", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);
  const uniqueName = uniqueItems[0].id;

  for (const query of ["고", "유", "고유", "고 유"]) {
    assert.equal(pageWorld.indexOf(uniqueName, query), 0, query);
    pageWorld.typeFilterQuery(query);
    const report = pageWorld.lastReport();
    assert.equal(report.고유키워드, true, query);
    const reportedNames = new Set(report.영어id);
    assert.ok(reportedNames.has(normalizeEnglish(uniqueName)), query);
    assert.deepEqual(
      [...report.고유아이템],
      [],
      `${query}: item class expansion stays off for the 고유 keyword`,
    );
  }

  // aliases are still searched while the keyword is active
  pageWorld.typeFilterQuery("고");
  assert.ok(new Set(pageWorld.lastReport().영어id).has("unique weapons"));

  // "고유" is the only keyword: every other query keeps the plain behaviour
  for (const query of [
    "유니크",
    "고유아이템",
    "유니크 아이템",
    "아이템",
    "방패",
    "투구",
    "알켐 에이라",
  ]) {
    pageWorld.typeFilterQuery(query);
    assert.equal(pageWorld.lastReport().고유키워드, false, query);
  }
  assert.equal(pageWorld.indexOf(uniqueName, "유니크"), -1);
});

test("고유 keyword report lists every unique item", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);
  pageWorld.typeFilterQuery("고유");
  const report = pageWorld.lastReport();
  assert.ok(report, "expected a console report for the 고유 keyword");
  assert.equal(report.고유키워드, true);
  const reportedNames = new Set(report.영어id);
  const missing = uniqueItems.filter(
    (row) => !reportedNames.has(normalizeEnglish(row.id)),
  );
  assert.deepEqual(
    missing.map((row) => row.id),
    [],
  );
});


test("Korean item class name expands to the unique items of that class", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);

  const shieldKorean = categoryKorean("Shield");
  assert.ok(shieldKorean, "expected a Shield entry in itemclasscategories");
  const shieldBaseItemIds = new Set(
    baseItemTypes
      .filter((row) => row.itemClass === "Shield")
      .map((row) => row.id),
  );
  const shieldUniques = uniqueItems.filter((row) =>
    shieldBaseItemIds.has(row.baseItem),
  );
  assert.ok(shieldUniques.length > 20);

  assert.equal(pageWorld.indexOf("Shield", shieldKorean), 0);
  const missed = shieldUniques.filter(
    (row) => pageWorld.indexOf(row.id, shieldKorean) !== 0,
  );
  assert.deepEqual(
    missed.map((row) => row.id),
    [],
  );
  assert.equal(
    pageWorld.indexOf("Alkem Eira", shieldKorean),
    0,
    "unique items of the class must match",
  );

  const helmetUnique = uniqueItems.find(
    (row) => itemClassByBaseItemId.get(row.baseItem) === "Helmet",
  );
  assert.equal(pageWorld.indexOf(helmetUnique.id, shieldKorean), -1);

  pageWorld.typeFilterQuery(shieldKorean);
  const report = pageWorld.lastReport();
  assert.deepEqual([...report.아이템분류], ["shield"]);
  assert.equal(report.고유아이템.length, shieldUniques.length);
  const reportedUniqueItems = new Set(report.고유아이템);
  const uniqueNames = new Set(uniqueItems.map((row) => normalizeEnglish(row.id)));
  assert.ok([...reportedUniqueItems].every((id) => uniqueNames.has(id)));
  assert.ok(shieldUniques.every((row) => reportedUniqueItems.has(normalizeEnglish(row.id))));
});

test("Korean base item name stays inside its own filter cell", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);

  const bodyArmour = baseItemTypes.find((row) => row.itemClass === "Body Armour");
  assert.equal(pageWorld.indexOf(bodyArmour.id, bodyArmour.ko), 0);
  assert.equal(
    pageWorld.indexOf(bodyArmour.itemClass, bodyArmour.ko),
    -1,
    `${bodyArmour.ko} must not match the ${bodyArmour.itemClass} cell`,
  );

  pageWorld.typeFilterQuery(bodyArmour.ko);
  const report = pageWorld.lastReport();
  assert.ok(report.영어id.includes(normalizeEnglish(bodyArmour.id)));
  assert.deepEqual([...report.고유아이템], []);
});

test("Korean unique name matches only that unique item", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);

  const uniqueRow = uniqueItems.find((row) => row.id === "Lavianga's Spirits");
  assert.ok(uniqueRow, "expected Lavianga's Spirits in uniqueitems.json");
  assert.equal(uniqueRow.ko, "라비앙가의 혼백");
  const itemClass = itemClassByBaseItemId.get(uniqueRow.baseItem);

  assert.equal(pageWorld.indexOf(uniqueRow.id, "라비앙가의 혼백"), 0);
  assert.equal(
    pageWorld.indexOf(itemClass, "라비앙가의 혼백"),
    -1,
    `라비앙가의 혼백 must not match the ${itemClass} cell`,
  );

  pageWorld.typeFilterQuery("라비앙가의 혼백");
  const report = pageWorld.lastReport();
  assert.deepEqual([...report.아이템분류], []);
  assert.deepEqual([...report.고유아이템], []);
});

test("Korean query report is written to the page console", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);
  assert.equal(pageWorld.koreanReports().length, 0);

  pageWorld.typeFilterQuery("방패");
  const reports = pageWorld.koreanReports();
  assert.equal(reports.length, 1);
  assert.ok(reports[0].args[1].includes("방패"));
  assert.ok(reports[0].args[2].영어id.length > 0);

  pageWorld.typeFilterQuery("shield");
  assert.equal(pageWorld.koreanReports().length, 1);
});

test("filter search inputs are refreshed when aliases arrive", () => {
  const filterInput = {
    value: "고유",
    dispatched: 0,
    matches: () => true,
    dispatchEvent() {
      this.dispatched += 1;
    },
  };
  const pageWorld = createPageWorld({ filterInputs: [filterInput] });
  pageWorld.dispatchAliases(aliasesPayload);
  assert.equal(filterInput.dispatched, 1);
});

test("older payload without unique names still matches Korean aliases", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases({
    source: "poe-ninja-korean-translation",
    type: "aliases",
    entries: [["Rare Ring", ["희귀 반지"]]],
  });
  assert.equal(pageWorld.indexOf("Rare Ring", "희귀"), 0);
  assert.equal(pageWorld.indexOf("Rare Ring", "고유"), -1);
});

test("English queries keep their native behaviour", () => {
  const pageWorld = createPageWorld();
  pageWorld.dispatchAliases(aliasesPayload);
  assert.equal(pageWorld.indexOf("Rare Ring", "Ring"), 5);
  assert.equal(pageWorld.indexOf("Rare Ring", "ring"), -1);
  assert.equal(pageWorld.includes("Rare Jewel", "Jewel"), true);
  assert.equal(pageWorld.includes("Rare Ring", "Jewel"), false);
});

test("query report can be silenced with the localStorage flag", () => {
  const pageWorld = createPageWorld({ localStorageValue: "0" });
  pageWorld.dispatchAliases(aliasesPayload);
  pageWorld.typeFilterQuery("방패");
  assert.deepEqual(pageWorld.koreanReports(), []);
});

test("demo payload builder matches the content script payload", async () => {
  const fileFetch = async (url) => {
    const fileName = decodeURIComponent(String(url)).replace(/^file:\/\/\/?/, "").replace(/^\/+/, "");
    const payload = JSON.parse(
      await readFile(fileName, "utf8"),
    );
    return { ok: true, status: 200, json: async () => payload };
  };
  const demoPayload = await loadSearchPayload(
    new URL(`file:///${translationDirectory.replace(/\\/g, "/")}/`),
    fileFetch,
  );

  assert.equal(demoPayload.source, aliasesPayload.source);
  assert.equal(demoPayload.type, aliasesPayload.type);

  const sortEntries = (entries) =>
    Array.from(entries, (entry) => [
      String(entry[0]),
      Array.from(entry[1], String).sort(),
    ]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  assert.deepEqual(
    sortEntries(demoPayload.entries),
    sortEntries(aliasesPayload.entries),
  );
  assert.deepEqual(
    Array.from(demoPayload.uniqueNames, String).sort(),
    Array.from(aliasesPayload.uniqueNames, String).sort(),
  );
  const sortLabels = (labels) =>
    Array.from(labels, (label) => [String(label[0]), String(label[1])]).sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
  assert.deepEqual(
    sortLabels(demoPayload.labels),
    sortLabels(aliasesPayload.labels),
  );
  assert.deepEqual(
    Array.from(demoPayload.itemClassUniqueItems, (entry) => [
      String(entry[0]),
      Array.from(entry[1], String),
    ]),
    Array.from(aliasesPayload.itemClassUniqueItems, (entry) => [
      String(entry[0]),
      Array.from(entry[1], String),
    ]),
  );
});
