# poe2_extensions

poe2 관련 확장 프로그램 코드 저장소(모노레포). 번역 데이터는 별도 저장소
`https://github.com/jun1bh1/poe2_translation` (`translations/**`, 2026-10-17 기준 **비공개**)에
있고, 확장 프로그램은 빌드 시 그 데이터를 `dist/`에 포함합니다.

> 새 세션/새 에이전트는 먼저 [`AGENTS.md`](AGENTS.md)를 읽으세요. 빌드 명령,
> 번역 규칙, 작업 상태, 알려진 함정(비공개 저장소로 인한 raw 404 포함)이 정리되어 있습니다.

## 구성

```
core/                  공통 코드 (모든 사이트가 공유)
  content.js           번역 엔진 — 이 저장소가 원본
  search-payload.js    검색 payload
sites/                 사이트별 확장 코드
  ninja/               poe.ninja 확장 (manifest.json, page_search.js)
  filter/              poe2 filter 사이트 확장 (같은 구성으로 추가)
pipeline/              번역 데이터 생성 도구 + package.json (npm 명령은 여기서 실행)
  scripts/             build_*.mjs, verify_*.mjs
tools/                 로컬 도구 (index.js, data-search*.js/html)
dist/                  빌드 산출물 — 직접 수정하지 않음
```

- 2026-10-17에 데이터 폴더 이름이 `poe2_translation_kr` → `poe2_translation`으로
  바뀌었습니다. 이 저장소의 코드가 원본이며, 데이터 폴더에는 `scripts/`,
  `userscripts/`, `chrome-extension/`이 더 이상 없습니다.

## 빌드

데이터 루트는 `POBKR_ROOT` 환경변수로 넘깁니다(레거시 이름). 개별 `npm run`은
형제 폴더를 자동 탐색하지 못하므로 직접 지정합니다.

```powershell
$env:POBKR_ROOT = 'C:\Users\Administrator\Documents\poe2_translation'
cd C:\Users\Administrator\Documents\poe2_extensions\pipeline

npm run build:extension    # -> ..\dist\poe-ninja-korean
npm run build:data-search  # -> ..\tools\data-search-data.js
npm run build:all          # 전체 파이프라인 (build-all.cmd는 루트를 자동 설정)
```

- `npm install`은 `pipeline/`에서 실행합니다. `playwright`는 `verify:*` 계열에서만 필요합니다.
- `dist/`를 새로 만든 뒤 `chrome://extensions`에서 확장을 Reload하고 페이지를
  완전히 새로고침해야 반영됩니다.
- `dist/`, `tools/data-search-data.js`는 생성물입니다. 직접 고치지 마세요.

## 새 사이트 확장 추가

1. `sites/<이름>/` 폴더를 만들고 `sites/ninja/`의 `manifest.json`·`page_search.js`를 복사
2. `manifest.json`의 `matches`/`name`, `page_search.js`의 사이트별 로직만 수정
3. `core/content.js`(엔진)와 `core/search-payload.js`는 그대로 재사용
4. `pipeline/scripts/build_chrome_extension.mjs`의 `resolveSourceFile` 후보에
   새 사이트 경로를 추가하고 `npm run build:extension`으로 빌드

## 주의

- `core/content.js`는 **엔진 단일 원본**입니다. 사이트별로 복사본을 만들지 말고 항상
  이 파일을 공유하세요(엔진을 고치면 모든 사이트 확장이 같은 내용을 쓰게 됩니다).
- `DATA_BASE_URL`은 유저스크립트 폴백에서만 쓰는 외부 주소입니다. 현재 값은 데이터
  커밋 `cc9d7d2…`를 가리키지만, **데이터 저장소가 비공개라 `raw.githubusercontent.com`
  접근은 404**입니다. 폴백을 쓰려면 저장소를 Public으로 전환하거나 데이터를 공개
  경로에 배포해야 합니다. 크롬 확장은 `dist`에 데이터를 포함하므로 영향이 없습니다.
  번역을 더 커밋하면 그 새 해시로 이 줄을 갱신하고 `npm run build:extension`으로
  `dist`를 다시 만드세요(`AGENTS.md` 7절).
- `sync-from-project.cmd`는 데이터 폴더에 코드 원본(`scripts/`, `userscripts/`)이
  있던 시절의 스크립트입니다. 현재 구조에서는 그대로 실행하면 실패합니다.
