# sites/ninja

poe.ninja 확장 코드의 **원본**입니다. 빌드하면 `dist/poe-ninja-korean`으로 복사됩니다.

- `manifest.json` — 확장 선언 (`matches: https://poe.ninja/poe2/*`, content_scripts, translations 노출)
- `page_search.js` — poe.ninja 페이지에 주입되는 사이트별 로직 (검색/필터)
- `INSTALL.md` — 설치 안내

`manifest.json`과 `page_search.js`는 스크립트로 만들 수 없는 **원본 코드**이므로
**이 폴더에서 직접 수정**합니다. 수정 후 `pipeline/`에서
`npm run build:extension`을 실행하면 `dist/poe-ninja-korean`에 반영됩니다.

과거 `pobkr\chrome-extension`을 미러링하던 방식(`sync-from-project.cmd`)은 폐기되었습니다.
