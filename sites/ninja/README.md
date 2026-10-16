# sites/ninja

poe.ninja 확장 코드. pobkr 프로젝트의 `chrome-extension\` 폴더를 미러링합니다.

- `manifest.json` — 확장 선언 (`matches: https://poe.ninja/poe2/*`, content_scripts, translations 노출)
- `page_search.js` — poe.ninja 페이지에 주입되는 사이트별 로직 (검색/필터)
- `INSTALL.md` — 설치 안내

이 두 파일은 스크립트로 만들 수 없는 **원본 코드**입니다. 수정은 pobkr의 `chrome-extension\`에서 하고,
`sync-from-project.cmd`를 실행하면 이 폴더로 복사되고 커밋·푸시까지 됩니다.
(경로: pobkr\chrome-extension → poe2_extensions\sites\ninja, robocopy `/E`)
