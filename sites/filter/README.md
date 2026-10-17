# sites/filter

poe2 필터 사이트 확장 코드 자리입니다. 새 사이트를 추가할 때는:

1. `sites/ninja/`의 `manifest.json`·`page_search.js`를 이 폴더로 복사
2. `manifest.json`의 `name`/`matches`를 필터 사이트 주소로 수정
3. `page_search.js`의 사이트별 DOM/조회 로직만 수정
4. `core/content.js`(번역 엔진)와 `core/search-payload.js`는 그대로 재사용
   (엔진을 사이트마다 복사하지 않습니다 — 단일 원본 유지)

번역 데이터는 빌드 시 `dist/<확장>/translations/`에 포함되며, 엔진은
`chrome.runtime.getURL('translations/...')`로 그 로컬 데이터만 읽습니다. 외부 다운로드가
없으므로 데이터 저장소가 비공개여도 됩니다. 유저스크립트용 raw 폴백은 제거되었습니다.
