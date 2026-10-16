# sites/filter

poe2 필터 사이트 확장 코드 자리입니다. 새 사이트를 추가할 때는:

1. `sites/ninja/`의 `manifest.json`·`page_search.js`를 이 폴더로 복사
2. `manifest.json`의 `name`/`matches`를 필터 사이트 주소로 수정
3. `page_search.js`의 사이트별 DOM/조회 로직만 수정
4. `core/content.js`(번역 엔진)와 `core/search-payload.js`는 그대로 재사용
   (엔진을 사이트마다 복사하지 않습니다 — 단일 원본 유지)

번역 데이터 주소(`DATA_BASE_URL`)는 데이터 저장소(`poe2_translation_kr`) 하나만 가리킵니다.
