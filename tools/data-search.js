// 번역 데이터 키 검색 페이지 (data-search.html).
//
// - translations/ 의 모든 JSON 키를 완전 일치 / 부분 일치로 찾는다.
// - 결과: 파일의 전체 주소 + 파일 구조 그대로(배열이면 그 객체, 객체면 그 항목) + 일치
//   부분과 값을 굵게.
// - "중복 검색": 같은 키가 여러 파일/테이블에 있는 그룹을 보여준다(그룹마다 5개까지,
//   "더보기"로 펼침). 값 충돌 그룹이 먼저 나온다.
// - http 로 열면 JSON 을 fetch 하고, file:// 로 열면(더블클릭) data-search-data.js 내장
//   데이터를 쓴다. 그 파일은 npm run build:data-search 로 만든다.
//
// 파일 목록은 data-search-files.js 의 DATA_SEARCH_FILES (content script 로드 순서) 이다.

const DATA_FILES = globalThis.DATA_SEARCH_FILES ?? [];
const RESULT_LIMIT = 300;
const DUPLICATE_GROUP_LIMIT = 5;
const DUPLICATE_OCCURRENCE_LIMIT = 5;
const FILE_BASE = new URL("translations/", document.baseURI);
const OVERRIDE_FILES = ["general/custom.json", "general/keyword.json"];

const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const modeSwitch = document.getElementById("mode-switch");
const modeLabel = document.getElementById("mode-label");
const searchButton = document.getElementById("search-button");
const duplicateButton = document.getElementById("duplicate-button");
const statusElement = document.getElementById("status");
const summaryElement = document.getElementById("summary");
const resultsElement = document.getElementById("results");

const entries = [];
const entriesByKey = new Map();
let mode = "exact";
let loaded = false;
let view = "search";

function normalize(value) {
  return String(value)
    .replace(/_/g, " ")
    .replace(/['\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 일치한 부분만 굵게 표시한다(대소문자는 무시).
function highlight(text, query) {
  const index = query
    ? text.toLocaleLowerCase("en").indexOf(query.toLocaleLowerCase("en"))
    : -1;
  if (index < 0) {
    return escapeHtml(text);
  }
  return (
    escapeHtml(text.slice(0, index)) +
    `<strong class="hit">${escapeHtml(
      text.slice(index, index + query.length),
    )}</strong>` +
    escapeHtml(text.slice(index + query.length))
  );
}

function addEntry(entry) {
  const item = { ...entry, key: normalize(entry.id) };
  entries.push(item);
  const list = entriesByKey.get(item.key);
  if (list) {
    list.push(item);
  } else {
    entriesByKey.set(item.key, [item]);
  }
}

// 파일 구조가 배열이면 항목 객체를, 객체면 id → 값 항목을 등록한다.
function registerPayload(fileName, payload) {
  if (Array.isArray(payload)) {
    payload.forEach((row, position) => {
      if (!row || typeof row !== "object" || typeof row.id !== "string") {
        return;
      }
      addEntry({ file: fileName, kind: "array", position, id: row.id, row });
    });
    return payload.length;
  }
  if (payload && typeof payload === "object") {
    Object.entries(payload).forEach(([id, korean], position) => {
      if (typeof korean !== "string") {
        return;
      }
      addEntry({ file: fileName, kind: "object", position, id, ko: korean });
    });
    return Object.keys(payload).length;
  }
  return 0;
}

// file:// 로 열었을 때 fetch 대신 쓸 내장 데이터(data-search-data.js)를 불러온다.
function ensureBundle() {
  if (globalThis.DATA_SEARCH_PAYLOADS) {
    return Promise.resolve(true);
  }
  if (location.protocol !== "file:") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "./data-search-data.js";
    script.onload = () => resolve(Boolean(globalThis.DATA_SEARCH_PAYLOADS));
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
}

async function loadFile(fileName) {
  const response = await fetch(new URL(fileName, FILE_BASE));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  registerPayload(fileName, payload);
  return payload;
}

async function loadAll() {
  const useBundle = location.protocol === "file:" && (await ensureBundle());
  const bundledPayloads = globalThis.DATA_SEARCH_PAYLOADS;
  let loadedFiles = 0;
  let skippedFiles = 0;
  let fromBundle = 0;
  for (const fileName of DATA_FILES) {
    statusElement.textContent = `검색 데이터를 불러오는 중… (${loadedFiles} / ${DATA_FILES.length}) ${fileName}`;
    if (useBundle && bundledPayloads[fileName] !== undefined) {
      registerPayload(fileName, bundledPayloads[fileName]);
      loadedFiles += 1;
      fromBundle += 1;
      continue;
    }
    try {
      await loadFile(fileName);
      loadedFiles += 1;
    } catch (error) {
      // 아직 없는 파일(빈 custom.json 등) 하나가 페이지를 멈추게 하지 않는다.
      const bundled = bundledPayloads?.[fileName];
      if (bundled !== undefined) {
        registerPayload(fileName, bundled);
        loadedFiles += 1;
        fromBundle += 1;
        continue;
      }
      skippedFiles += 1;
      console.warn(`[data-search] ${fileName} 건너뜀: ${error.message}`);
    }
  }
  loaded = true;
  const builtAt = globalThis.DATA_SEARCH_BUNDLE?.builtAt ?? "";
  const source = fromBundle
    ? `내장 데이터 ${fromBundle}개${
        builtAt ? ` (${builtAt.slice(0, 16).replace("T", " ")} 생성)` : ""
      }`
    : "JSON 직접 읽기";
  statusElement.textContent = `키 ${entries.length.toLocaleString(
    "ko",
  )}개 로드 완료 (파일 ${loadedFiles} / ${DATA_FILES.length}개${
    skippedFiles ? `, 건너뜀 ${skippedFiles}개` : ""
  } · ${source})`;
  if (loadedFiles === 0) {
    statusElement.textContent =
      location.protocol === "file:"
        ? "내장 데이터가 없습니다. npm run build:data-search 를 한 번 실행한 뒤 새로고침하세요."
        : "검색 데이터를 하나도 불러오지 못했습니다. python -m http.server 8000 같은 로컬 서버로 열어 주세요.";
  }
}

function entryValue(entry) {
  return entry.kind === "array" ? (entry.row.ko ?? "") : entry.ko;
}

function renderValueText(value) {
  if (typeof value === "string") {
    return `"${escapeHtml(value)}"`;
  }
  const json = JSON.stringify(value, null, 2) ?? String(value);
  return escapeHtml(json).replace(/\n/g, "\n    ");
}



// 파일 구조가 배열이면 그 객체를, 객체면 그 항목(id → 값)을 그대로 보여준다.
// 검색 대상은 키이므로, 배열 파일에서는 id 값에, 객체 파일에서는 항목 이름에 표시를 남긴다.
function renderEntry(entry, query) {
  const isObjectFile = entry.kind === "object";
  const pairs = isObjectFile ? [[entry.id, entry.ko]] : Object.entries(entry.row);
  const lines = pairs.map(([key, value]) => {
    const keyHtml = isObjectFile ? highlight(key, query) : escapeHtml(key);
    const valueHtml =
      !isObjectFile && key === "id"
        ? `"${highlight(String(value), query)}"`
        : renderValueText(value);
    const boldValue = isObjectFile || key === "ko";
    return `  <span class="key">"${keyHtml}"</span>: <span class="value${
      boldValue ? " strong" : ""
    }">${valueHtml}</span>`;
  });
  return `{\n${lines.join(",\n")}\n}`;
}

function fileUrlOf(entry) {
  return new URL(entry.file, FILE_BASE).href;
}

function metaOf(entry) {
  return [
    entry.kind === "array" ? "배열 항목" : "객체 항목",
    `#${entry.position + 1}`,
    entry.kind === "array" && typeof entry.row.table === "string"
      ? `table: ${entry.row.table}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderResult(entry, query) {
  const fileUrl = fileUrlOf(entry);
  const item = document.createElement("li");
  item.className = "result";
  item.innerHTML = `
      <div class="head">
        <a class="file" href="${escapeHtml(fileUrl)}">${escapeHtml(fileUrl)}</a>
        <span class="meta">${escapeHtml(metaOf(entry))}</span>
      </div>
      <pre>${renderEntry(entry, query)}</pre>
    `;
  return item;
}

// 중복 그룹의 한 항목(파일 주소 + 구조 + 값, 적용되는 항목에는 배지).
function renderOccurrence(entry, isEffective) {
  const fileUrl = fileUrlOf(entry);
  const item = document.createElement("li");
  item.className = "occurrence";
  item.innerHTML = `
      <div class="head">
        <a class="file" href="${escapeHtml(fileUrl)}">${escapeHtml(fileUrl)}</a>
        <span class="meta">${escapeHtml(metaOf(entry))}</span>
        ${isEffective ? '<span class="badge applied">적용</span>' : ""}
      </div>
      <pre>${renderEntry(entry, "")}</pre>
    `;
  return item;
}

function findMatches(query) {
  const needle = normalize(query);
  if (!needle) {
    return [];
  }
  return entries.filter((entry) =>
    mode === "exact" ? entry.key === needle : entry.key.includes(needle),
  );
}

// 같은 키가 여러 파일/테이블에 있는 그룹. 값 충돌 그룹을 먼저, 그다음 출현 수가 많은 순.
function buildDuplicateGroups() {
  const groups = [];
  for (const [key, list] of entriesByKey) {
    if (list.length < 2) {
      continue;
    }
    const values = [...new Set(list.map((entry) => entryValue(entry)))];
    groups.push({
      key,
      list,
      values,
      conflict: values.length > 1,
      effective: effectiveEntry(list),
    });
  }
  groups.sort(
    (a, b) =>
      Number(b.conflict) - Number(a.conflict) ||
      b.list.length - a.list.length ||
      a.key.localeCompare(b.key),
  );
  return groups;
}

// 확장 프로그램과 같은 규칙: custom → keyword → 로드 순서가 빠른 파일.
function effectiveEntry(list) {
  for (const fileName of OVERRIDE_FILES) {
    const found = list.find((entry) => entry.file === fileName);
    if (found) {
      return found;
    }
  }
  return [...list].sort(
    (a, b) => DATA_FILES.indexOf(a.file) - DATA_FILES.indexOf(b.file),
  )[0];
}

// 중복 그룹 하나: 키 + 요약 + 항목(기본 5개) + "더보기".
function renderDuplicateGroup(group) {
  const item = document.createElement("li");
  item.className = "dup-group";
  const meta = [
    `${group.list.length}개 항목`,
    `파일 ${new Set(group.list.map((entry) => entry.file)).size}개`,
    group.conflict ? `값 ${group.values.length}종` : "값 동일",
  ].join(" · ");
  item.innerHTML = `
      <div class="head">
        <code class="dup-key">${escapeHtml(group.key)}</code>
        <span class="meta">${escapeHtml(meta)}</span>
        ${group.conflict ? '<span class="badge">값 충돌</span>' : ""}
      </div>
    `;
  const list = document.createElement("ul");
  list.className = "occurrences";
  const append = (from, to) => {
    for (let index = from; index < to; index += 1) {
      list.append(
        renderOccurrence(group.list[index], group.list[index] === group.effective),
      );
    }
  };
  const first = Math.min(DUPLICATE_OCCURRENCE_LIMIT, group.list.length);
  append(0, first);
  item.append(list);
  if (group.list.length > first) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "more";
    button.textContent = `더보기 (${group.list.length - first}개)`;
    button.addEventListener("click", () => {
      append(first, group.list.length);
      button.remove();
    });
    item.append(button);
  }

  return item;
}

function runSearch() {
  view = "search";
  const query = queryInput.value.trim();
  resultsElement.replaceChildren();
  summaryElement.textContent = "";
  if (entries.length === 0) {
    summaryElement.textContent = "검색 데이터가 아직 준비되지 않았습니다.";
    return;
  }
  if (!query) {
    summaryElement.textContent = "검색어를 입력하세요.";
    return;
  }
  const matches = findMatches(query);
  const shown = matches.slice(0, RESULT_LIMIT);
  for (const entry of shown) {
    resultsElement.append(renderResult(entry, query));
  }
  if (matches.length > shown.length) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = `${(
      matches.length - shown.length
    ).toLocaleString("ko")}건 더 있습니다. 검색어를 더 구체적으로 입력하세요.`;
    resultsElement.append(more);
  }
  summaryElement.textContent = `${
    mode === "exact" ? "완전 검색" : "부분 일치"
  } "${query}" — 키 ${matches.length.toLocaleString("ko")}개 일치${
    matches.length > shown.length ? ` (${shown.length}개 표시)` : ""
  }`;
}

function runDuplicateSearch() {
  view = "duplicates";
  resultsElement.replaceChildren();
  summaryElement.textContent = "";
  if (entries.length === 0) {
    summaryElement.textContent = "검색 데이터가 아직 준비되지 않았습니다.";
    return;
  }
  const groups = buildDuplicateGroups();
  const conflicts = groups.filter((group) => group.conflict).length;
  summaryElement.textContent = `중복 키 ${groups.length.toLocaleString(
    "ko",
  )}개 (값 충돌 ${conflicts.toLocaleString(
    "ko",
  )}개) — 값 충돌 그룹부터, 그룹마다 최대 ${DUPLICATE_OCCURRENCE_LIMIT}개 항목 · 한 번에 ${DUPLICATE_GROUP_LIMIT}그룹`;
  const more = document.createElement("li");
  more.className = "more";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "more";
  more.append(button);
  let shown = 0;
  const renderNextBatch = () => {
    const end = Math.min(shown + DUPLICATE_GROUP_LIMIT, groups.length);
    const fragment = document.createDocumentFragment();
    for (; shown < end; shown += 1) {
      fragment.append(renderDuplicateGroup(groups[shown]));
    }
    resultsElement.insertBefore(fragment, more);
    if (shown < groups.length) {
      button.textContent = `그룹 더보기 (5개씩 · 남은 ${(
        groups.length - shown
      ).toLocaleString("ko")}개)`;
      if (!more.isConnected) {
        resultsElement.append(more);
      }
    } else {
      more.remove();
    }
  };
  button.addEventListener("click", renderNextBatch);
  resultsElement.append(more);
  renderNextBatch();
}

function setMode(next) {
  mode = next;
  modeSwitch.checked = next === "partial";
  modeLabel.textContent = next === "exact" ? "완전" : "부분";
  if (view === "search" && queryInput.value.trim()) {
    runSearch();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
searchButton.addEventListener("click", (event) => {
  event.preventDefault();
  runSearch();
});
modeSwitch.addEventListener("change", () =>
  setMode(modeSwitch.checked ? "partial" : "exact"),
);
duplicateButton.addEventListener("click", () => runDuplicateSearch());

// 검증 스크립트가 같은 데이터로 확인할 수 있도록 최소한의 상태만 노출한다.
globalThis.__dataSearch = {
  ready: () => loaded,
  count: () => entries.length,
  mode: () => mode,
  view: () => view,
  search: (query) =>
    findMatches(query).map((entry) => ({
      file: entry.file,
      kind: entry.kind,
      id: entry.id,
      ko: entryValue(entry),
    })),
  duplicateGroups: () =>
    buildDuplicateGroups().map((group) => ({
      key: group.key,
      count: group.list.length,
      conflicts: group.values.length,
      effectiveFile: group.effective?.file ?? "",
    })),
};

setMode("exact");
loadAll();

