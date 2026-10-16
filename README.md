# poe2_extensions

poe2 관련 확장 프로그램 코드 저장소(모노레포). 번역 데이터는 별도 저장소
`https://github.com/jun1bh1/poe2_translation_kr` (공개, `translations/**`)에 있고,
확장 프로그램들이 런타임에 그 주소에서 데이터를 받아옵니다.

## 구성

```
core/                  공통 코드 (모든 사이트가 공유)
  content.js           번역 엔진 (= poe2_translation_kr/userscripts/poe-ninja-translation.user.js)
  search-payload.js    검색 payload
sites/                 사이트별 확장 코드
  ninja/               poe.ninja 확장 (manifest.json, page_search.js)
  filter/              poe2 filter 사이트 확장 (같은 구성으로 추가)
pipeline/              번역 데이터 생성 도구 (poe2_translation_kr의 scripts/ 사본)
tools/                 로컬 도구 (index.js, data-search*.js/html 사본)
```

## 사용법

1. 원본 코드를 갱신한 뒤 이 저장소로 복사 + 커밋:
   ```
   sync-from-project.cmd                 (기본: ..\poe2_translation_kr, 없으면 ..\pobkr)
   sync-from-project.cmd "D:\work\poe2_translation_kr"
   ```
2. 최초 1회 리모트 등록:
   ```
   git remote add origin https://github.com/jun1bh1/poe2_extensions.git
   git push -u origin master
   ```

## 새 사이트 확장 추가

1. `sites/<이름>/` 폴더를 만들고 `sites/ninja/`의 `manifest.json`·`page_search.js`를 복사
2. `manifest.json`의 `matches`/`name`, `page_search.js`의 사이트별 로직만 수정
3. `core/content.js`(엔진)와 번역 데이터 주소(`DATA_BASE_URL`)는 그대로 재사용

## 주의

- `core/content.js`는 **엔진 단일 원본**입니다. 사이트별로 복사본을 만들지 말고 항상 이 파일을
  공유하세요(엔진을 고치면 모든 사이트 확장이 같은 내용을 쓰게 됩니다).
- 번역 데이터 저장소 주소는 확장이 실행 중에 참조하는 **유일한 외부 주소**입니다.
  데이터 저장소를 바꾸면 각 확장의 `DATA_BASE_URL` 한 줄만 새 주소(커밋 해시 포함)로 갱신합니다.
- `pipeline/`, `tools/`는 백업 사본입니다. 실행은 데이터 폴더(poe2_translation_kr)에서 합니다.
