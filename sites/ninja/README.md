# sites/ninja

poe.ninja 확장 코드 자리입니다. 아래 두 파일이 들어갑니다.

- `manifest.json` — 확장 선언 (`matches: https://poe.ninja/poe2/*`, content_scripts, translations 노출)
- `page_search.js` — poe.ninja 페이지에 주입되는 사이트별 로직

`manifest.json`·`page_search.js`는 스크립트로 만들 수 없는 **원본 코드**입니다.
로컬 프로젝트(pobkr)의 `chrome-extension\` 폴더에 있는 파일을 그대로 복사해 두고,
`sync-from-project.cmd`를 실행하면 자동으로 이 폴더로 복사됩니다.

> 현재 pobkr의 `chrome-extension\` 폴더가 삭제된 상태라 아직 비어 있습니다.
> (휴지통에서 복구하거나 백업에서 되돌린 뒤 `sync-from-project.cmd` 실행)
