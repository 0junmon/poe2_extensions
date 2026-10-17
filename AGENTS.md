# AGENTS.md — 작업 인수인계

최종 갱신: 2026-10-17

새 세션/새 에이전트는 이 파일을 먼저 읽고, 그다음 `README.md`와
`sites/ninja/INSTALL.md`를 읽는다. 이 문서는 "지금 실제로 어떻게 동작하는지"만 적는다.
과거 문서에 남은 `userscripts/`, `chrome-extension/`
경로는 **레거시**이며 현재 데이터 폴더에는 존재하지 않는다.

## 0. 새 에이전트 시작 체크리스트

> **같은 PC에서 이어받는 경우**: 2~4번(클론·데이터 복사)은 필요 없다. 두 경로가
> 이미 있으므로 5번(환경 확인)부터 진행하면 된다.

1. 이 파일 → `README.md` → `sites/ninja/PUBLISHING.md` → `sites/ninja/INSTALL.md` 순서로 읽는다.
2. 두 저장소 경로가 있는지 확인한다. 없으면(둘 다 **비공개**) GitHub 로그인 후 클론한다.
   ```powershell
   gh auth login
   git clone https://github.com/jun1bh1/poe2_translation.git
   git clone https://github.com/jun1bh1/poe2_extensions.git
   ```
3. 두 저장소가 클린인지 확인한다. `git status -sb`가
   `## master...origin/main` / `## master...origin/master`이고 ahead/behind가 없어야 한다.
   최신 커밋은 `git log --oneline -1`로 확인한다(문서에 해시를 고정하지 않는다).
4. **`data/`는 Git에 없다.** 다른 PC라면 원본 PC에서 직접 복사해야 한다.
   - `poe2_translation/data/balance` (1,024개, 약 315MB)
   - `poe2_translation/data/statdescriptions` (`.csd` 589개)
   - `translations/` 편집과 확장 빌드만 할 때는 `data/`가 없어도 된다.
     `npm run build:all`/`build:translation-map` 같은 전체 파이프라인에만 필요하다.
5. 환경: Windows + PowerShell, Node 20+ (검증: v24.21.0), Python 3(전체 빌드만), Chrome.
6. 기준 폴더를 지정하고 검사로 시작 상태를 확인한다.
   ```powershell
   $env:TRANSLATION_ROOT = 'C:\Users\Administrator\Documents\poe2_translation'
   cd C:\Users\Administrator\Documents\poe2_extensions\pipeline
   npm run verify:data
   ```
7. 빌드/배포: `sites/ninja/package-extension.ps1` → `dist/poe-ninja-korean-v<version>.zip`.
   수동 테스트: `chrome://extensions` → Load unpacked → `dist/poe-ninja-korean`.
8. `dist/`, `tools/data-search-data.js`, `tools/ninja-test.html`은 생성물/로컬 전용이다.
   직접 수정하거나 커밋하지 않는다.

## 1. 저장소 두 개

| 역할 | 로컬 경로 | GitHub | Git 추적 대상 |
| --- | --- | --- | --- |
| 번역 데이터(산출물) | `C:\Users\Administrator\Documents\poe2_translation` | `jun1bh1/poe2_translation` | `translations/**` 만 |
| 코드/빌드 도구 | `C:\Users\Administrator\Documents\poe2_extensions` | `jun1bh1/poe2_extensions` | `core/`, `sites/`, `pipeline/`, `tools/` (단, `dist/`와 `tools/data-search-data.js`는 Git 제외) |

- 데이터 폴더의 `data/`(게임 덤프, `.csd` 추출물, 백업)는 `.gitignore` 대상이라
  GitHub에 올라가지 않는다. 로컬에만 있다(약 315MB + `data/statdescriptions` 589파일).
- 2026-10-17에 데이터 폴더 이름을 `poe2_translation`으로 바꿨다.
  Git 히스토리와 리모트는 새 이름 그대로 유지된다. 옛 이름의 폴더는 더 이상 없다.
- **코드 원본은 `poe2_extensions`에만 있다.** 데이터 폴더에는 `scripts/`,
  `userscripts/`, `chrome-extension/`, `index.js`, `package.json`이 없다.
  따라서 "데이터 폴더에서 스크립트를 실행한다"는 옛 설명은 더 이상 맞지 않는다.

## 2. 2026-10-17 작업 시작 시점 상태 (기록)

> 이 절은 당시 상태 기록이다. 최신 HEAD와 변경 여부는 `git log --oneline -1`과
> `git status -sb`로 확인한다.

데이터 repo:
- HEAD `9c3604a` (`Restructure translations into general/items/names/lines`), `master` = `origin/main`
- modified: `translations/general/custom.json`, `keyword.json`, `poe_ninja.json`
- 세 파일 모두 JSON 파싱 정상 (custom 19행, keyword 110행, poe_ninja 210키)

코드 repo:
- HEAD `071afca` (`sync from project ...`), `master` = `origin/master`
- modified 10개: `README.md`, `core/content.js`, `pipeline/build-all.cmd`,
  `pipeline/build_translation_map.py`, `pipeline/scripts/build_unique_items.mjs`,
  `pipeline/scripts/source-root.mjs`, `sites/filter/README.md`,
  `sites/ninja/INSTALL.md`, `sites/ninja/README.md`, `sync-from-project.cmd`
- untracked 3개: `AGENTS.md`(이 문서), `tools/data-search-data.js`(생성물, 약 6.5MB),
  `tools/ninja-test.html`
- `dist/`는 `.gitignore` 대상이라 커밋되지 않는다. 확장을 배포하려면 각자
  `npm run build:extension`으로 다시 만든다.

## 3. 빌드/실행

기준 폴더(데이터 루트)는 `TRANSLATION_ROOT` 환경변수로 넘긴다. 이전 이름
`POBKR_ROOT`는 레거시 호환용 fallback으로만 지원한다.

우선순위 (`pipeline/scripts/project-root.mjs`, `build_all.mjs`):
`--root` 인자 > `TRANSLATION_ROOT` (없으면 `POBKR_ROOT`) > 스크립트 위치에서
위로 올라가며 `data/balance` 탐색

`pipeline/build-all.cmd`는 실행 시 `TRANSLATION_ROOT`를 **형제 폴더**
`..\..\poe2_translation`로 자동 설정한다. 개별 `npm run ...`을 직접 실행할 때는
자동 탐색이 형제 폴더를 찾지 못하므로 환경변수를 직접 지정한다.

```powershell
$env:TRANSLATION_ROOT = 'C:\Users\Administrator\Documents\poe2_translation'
cd C:\Users\Administrator\Documents\poe2_extensions\pipeline

npm run build:all          # 전체 파이프라인 (또는 ..\build-all.cmd 더블클릭)
npm run build:extension    # -> ..\dist\poe-ninja-korean (확장 unpacked 폴더)
npm run build:data-search  # -> ..\tools\data-search-data.js (file:// 용 내장 번들)
npm run verify:data        # JSON/템플릿/우선순위/dist 동기화 검사 (의존성 없음)
```

- `package.json`은 **`pipeline/` 안에만** 있다. `poe2_extensions` 루트에는 없다.
- 빌드/패키징 스크립트는 **Node 내장 모듈만** 사용한다. 외부 의존성이 없으므로
  `npm install`이 필요 없다(Playwright 기반 자동 검증은 제거됨).
- `build:extension`은 코드 루트(`sites`가 있는 폴더)의 `dist/poe-ninja-korean`에
  `manifest.json`, `content.js`(= `core/content.js`), `page_search.js`,
  `translations/**` 18개 파일을 복사한다.
- `dist`를 새로 만든 뒤에는 `chrome://extensions`에서 확장을 **Reload**하고,
  poe.ninja 페이지도 **완전 새로고침**해야 반영된다.
- 배포용 ZIP은 `sites/ninja/package-extension.ps1`로 만든다. 이 스크립트는
  빌드까지 수행하고 ZIP 엔트리를 반드시 `/` 구분자로 쓴다(Chrome 업로드 요구사항).
  결과: `dist/poe-ninja-korean-v<version>.zip`. 절차는 `sites/ninja/PUBLISHING.md`.

## 4. 데이터 구조와 편집 대상

`translations/`는 설명 대상별로 나뉜다.

| 폴더 | 파일 | 내용 |
| --- | --- | --- |
| `general/` | `poe_ninja.json`, `keyword.json`, `custom.json` | poe.ninja UI 라벨, 수동 키워드, 수동 오버라이드 |
| `items/` | `base_items.json`, `base_item_variants.json`, `unique_items.json`, `item_classes.json`, `item_class_singulars.json` | 아이템 이름/분류 |
| `names/` | `game_terms.json`, `name_dictionary.json`, `mods.json`, `keywordpopups.json`, `area_and_quest_names.json`, `character_classes.json` | 고유명사, 지역/퀘스트, 클래스 |
| `lines/` | `item_mod_lines.json`, `skill_gem_lines.json`, `stat_lines.json`, `flavour_text.json`, `keyword_definitions.json` | 모드/스킬/스탯/설명 문장 |

- **손으로 고치는 파일은 `general/` 3개뿐이다.**
  - `custom.json`, `keyword.json`: `[{ "id": "...", "ko": "..." }]` 배열
  - `poe_ninja.json`: `{ "English": "한국어" }` **객체** (배열로 바꾸지 말 것)
- 나머지는 파이프라인 산출물이다. 직접 고치면 다음 빌드에서 덮어써진다.
- 로드 순서(뒤가 우선): 인터페이스 → `CORE_DATA_FILES` → 라인 데이터 →
  `keyword.json` → `custom.json`.

## 5. 번역 엔진 규칙

`core/content.js`는 모든 사이트 확장이 공유하는 **단일 원본**이다. 사이트별로
복사하지 않는다.

- **정확 일치 우선**: `translations` 맵에 정규화된 키가 그대로 있으면 그것을 쓴다
  (`content.js`의 `exactTranslation`). 그다음에 템플릿/인라인 번역을 시도한다.
- **`#` = 스탯 템플릿**: 숫자/값의 개수를 가리지 않는 패턴. 한국어 쪽에서
  `{0}`, `{1}`로 순서를 바꿀 수 있다.
  예: `"Provides # Units of Raw # Lifeforce when Harvested"` →
  `"수확 시 미가공 {1} 생기 {0}개 제공"`
- **`{0}`/`{1}` = 위치 기반 치환**: `custom.json`/`poe_ninja.json`에서 값 하나를
  끼워 넣는다. `{0}`이 이름이면 그 이름도 번역해서 넣고, 숫자면 그대로 넣는다.
  예: `"Converted from Physical ({0}%)"` → `"물리 피해에서 전환 ({0}%)"`
- **행을 값마다 추가하지 말고 템플릿 한 행으로 처리한다.** `Hour 3/6/12/18`,
  `Week 1..5`, `Act 2..4`, `Day 1..6`, `Unique Weapons/Armours/...` 같은
  반복 문자열은 `Hour {0}`, `Week {0}`, `Unique {0}` 형태가 정답이다.
- 리스트 구분자는 `", "`, `" · "` (`LIST_SEPARATORS`). 목록은 부분별로
  번역하고, 데이터가 없는 부분은 영어로 남긴다.
- 매칭 우선순위는 **exact → `{0}`/`{1}` 템플릿 → `#` 스탯 템플릿 →
  `": "`/목록 분해** 순서다. `"Companion: {0}"` 같은 행이 `"Companion"` 단어
  번역보다 먼저 적용된다.
- 값 패턴은 `TEMPLATE_VALUE_PATTERN`(숫자, 범위, 괄호, 부호)으로 인식한다.
- `id`/`ko`에 `[UNUSED]`, `[DNT-UNUSED]`가 있으면 생성 단계에서 버린다.
- 행 형식은 어디서나 `{id, ko}`이고, `table` 필드는 로컬 감사 도구용 선택 필드다
  (`clean:translations`가 제거).

## 6. UI/산출물 규칙

- poe.ninja UI는 shadow DOM을 쓰지 않는다. `#poe-ninja-korean-ui` div 하나와
  `<head>`의 `#poe-ninja-korean-ui-style` 하나를 넣고, 모든 선택자를
  `#poe-ninja-korean-ui` 아래로 스코프한다.
- `data-tooltip-trigger`가 붙은 키워드 span은 **줄 합치기 전에 먼저** 번역한다.
  그 키워드가 번역되면 해당 줄은 재구성하지 않고 기존 span/툴팁을 보존한다.
- `dist/`는 생성물이다. 직접 고치지 말고 `npm run build:extension`으로 다시 만든다.
- `tools/data-search-data.js`(약 6.5MB)는 `npm run build:data-search` 생성물이다.
  `tools/data-search.html`을 `file://`로 열 때 fetch 대신 쓰는 번들이다.
- `tools/ninja-test.html`은 로컬 확인용 페이지다(저장소에는 올리지 않음).

## 7. 알려진 함정 / 반드시 알아야 할 것

1. **배포는 크롬 확장 단일 경로 (2026-10-17 결정)**
   - 유저스크립트(Tampermonkey) 배포는 중단했다. `core/content.js`에서
     `DATA_BASE_URL`과 `GM_xmlhttpRequest` 폴백을 제거했다.
   - 확장은 빌드 시 `translations/**`를 `dist`에 포함하고
     `chrome.runtime.getURL('translations/...')`로만 읽는다. **네트워크 요청이 없다.**
   - 따라서 데이터/코드 저장소가 **비공개여도** 배포·사용에 문제가 없다.
     (2026-10-17 기준 두 저장소 모두 PRIVATE)
   - 배포물은 `dist/poe-ninja-korean` 폴더를 zip으로 묶어 Chrome Web Store 등에 올린다.
   - 번역을 갱신하면 `npm run build:extension` 후 zip을 다시 만들고 manifest version을 올린다.
2. **환경변수 표준 이름은 `TRANSLATION_ROOT`**다. `POBKR_ROOT`는 레거시 셸/작업
   설정을 위해 fallback으로만 남아 있다. 모든 사용처를 새 이름으로 바꾼 뒤
   fallback을 제거한다.
3. **`sync-from-project.cmd`는 현재 그대로는 실패한다.** 소스로
   `%SRC%\scripts\build_all.mjs`, `userscripts\`, `chrome-extension\`을 기대하는데
   데이터 폴더에 해당 폴더가 없다. 코드 원본은 이 저장소(`poe2_extensions`)이며,
   `pipeline/`이 그 사본이다.
4. `pipeline/scripts/source-root.mjs`는 두 배치(데이터 폴더형/모노레포형)를 모두
   지원하도록 되어 있다. 데이터 폴더형 경로(`../chrome-extension`,
   `../userscripts`)는 현재 존재하지 않으므로 모노레포 후보가 선택된다.
5. `data/balance`는 1,024개 파일 약 315MB, `data/statdescriptions`는 `.csd` 589개다.
   `stat_lines.json`(25,730행)은 이 `.csd`에서 생성됐다.
6. 문서에 남은 옛 프로젝트명 표기는 가능한 한 새 이름으로 고친다.

## 8. 작업 상태 (2026-10-17 기준)

완료:
1. 데이터 repo 번역 커밋·푸시, `Legacy` 자리표시자 수정
2. 크롬 확장 단일 배포로 전환: 유저스크립트 폴백(`DATA_BASE_URL`) 제거
3. Playwright 검증 제거, 의존성 없는 `npm run verify:data` 추가
4. `npm run build:extension` / `npm run build:data-search` 재생성
5. 코드 repo 변경(엔진/파이프라인 + 문서 + 검사 스크립트) 커밋·푸시
6. `dist/poe-ninja-korean-v0.6.24.zip` 생성
7. 환경변수 표준 이름을 `TRANSLATION_ROOT`로 변경 (`POBKR_ROOT` fallback 유지)

남은 것(배포):
1. Chrome Web Store 개발자 등록 후 zip 업로드
2. 아이콘(16/32/48/128)과 스토어 스크린샷/프로모션 이미지 준비 — 현재 아이콘 없음
3. 개인정보처리방침에 "데이터 수집/전송 없음" 명시
4. 업로드할 때마다 manifest `version` 증가

남은 것(정리, 선택):
1. 모든 셸/작업 설정을 `TRANSLATION_ROOT`로 바꾼 뒤 `POBKR_ROOT` fallback 제거
2. `sync-from-project.cmd`를 현재 구조에 맞게 재작성하거나 폐기 표시

## 9. 검증

자동 브라우저 테스트(Playwright)는 제거했다. 아래의 의존성 없는 검사와 **수동 확인**만 쓴다.

```powershell
# JSON 유효성 (데이터 repo 루트에서)
node -e "for (const f of ['translations/general/custom.json','translations/general/keyword.json','translations/general/poe_ninja.json']) { const j=JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, Array.isArray(j)?j.length:Object.keys(j).length, 'OK'); }"

# 데이터/템플릿/우선순위 + dist 동기화 (의존성 없음)
cd C:\Users\Administrator\Documents\poe2_extensions\pipeline
npm run verify:data -- --strict-dist

# 빌드 + ZIP (코드 repo)
cd C:\Users\Administrator\Documents\poe2_extensions\sites\ninja
.\package-extension.ps1
```

수동 확인: `chrome://extensions` → **Load unpacked** → `dist\poe-ninja-korean` →
`poe.ninja/poe2` 페이지에서 번역/검색이 되는지, 콘솔에 오류/404가 없는지 본다.

