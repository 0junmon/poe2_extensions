# Chrome Web Store 배포

이 확장은 **크롬 확장 단일 배포**를 전제로 한다. 번역 데이터는 빌드 시
`dist/poe-ninja-korean/translations/`에 포함되며, 실행 중 네트워크 요청을 하지 않는다.
따라서 데이터/코드 저장소가 비공개여도 배포·사용에 문제가 없다.

## 1. 빌드 + ZIP

```powershell
cd C:\Users\Administrator\Documents\poe2_extensions\sites\ninja
.\package-extension.ps1
```

- 기본 데이터 경로: `C:\Users\Administrator\Documents\poe2_translation`
- 다른 경로: `.\package-extension.ps1 -DataRoot "D:\work\poe2_translation"`
- 결과: `dist\poe-ninja-korean-v<version>.zip`
- ZIP 엔트리는 반드시 `/` 구분자여야 한다. `Compress-Archive`는 `\`를 쓰므로
  이 스크립트는 `System.IO.Compression`으로 직접 만든다.
- `manifest.json`은 ZIP **루트**에 있어야 한다(상위 폴더 포함 금지).

## 2. 로컬 확인

1. `chrome://extensions` → 개발자 모드 ON
2. **Load unpacked** → `dist\poe-ninja-korean` 선택
3. `https://poe.ninja/poe2/...` 접속 → 번역/검색 UI 확인
4. 콘솔에 404/네트워크 오류가 없는지 확인 (확장은 외부 요청을 하지 않는다)

## 3. 스토어 업로드

1. Chrome Web Store 개발자 계정 등록(1회 등록비)
2. 새 아이템 생성 → ZIP 업로드
3. 스토어 등록정보 작성
   - 이름/설명(한국어), 카테고리
   - 스크린샷 1장 이상(1280×800 또는 640×400)
   - 128×128 스토어 아이콘
4. 개인정보처리방침 URL 등록 — 아래 문구 사용 가능
5. 심사 제출

## 4. 아이콘

현재 `manifest.json`에 아이콘이 없다. 스토어 등록에는 128×128 아이콘이 필요하고,
확장 목록/툴바 표시를 위해 `icons`(16/32/48/128)와 `action.default_icon`을 추가하는 것이 좋다.

```json
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

아이콘 파일을 `sites/ninja/icons/`에 넣고 `package-extension.ps1` 실행 시
`dist`로 복사되도록 `build_chrome_extension.mjs`에 복사 단계를 추가해야 한다.

## 5. 버전

업로드할 때마다 `sites/ninja/manifest.json`의 `version`을 올린다.
ZIP 파일명도 버전을 따라간다(`poe-ninja-korean-v0.6.24.zip`).

## 6. 개인정보처리방침 문구(초안)

> 이 확장 프로그램은 poe.ninja의 Path of Exile 2 페이지에 한국어 번역과 검색 기능을
> 제공합니다. 번역 데이터는 확장 프로그램에 포함되어 있으며, 사용자의 개인정보를
> 수집·저장·전송하지 않습니다. 외부 서버와 통신하지 않습니다. 문의: <이메일 주소>.

## 7. 배포 체크리스트

- [ ] `manifest.json` version 증가
- [ ] `npm run verify:data -- --strict-dist` 통과 (`pipeline/`에서)
- [ ] `.\package-extension.ps1` 실행 성공
- [ ] ZIP 루트에 `manifest.json` 존재
- [ ] ZIP 엔트리 구분자가 `/`인지 확인
- [ ] `dist\poe-ninja-korean` Load unpacked로 동작 확인
- [ ] 아이콘/스크린샷/개인정보처리방침 준비
- [ ] 심사 제출
