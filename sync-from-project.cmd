@echo off
rem pobkr 프로젝트의 원본 코드를 이 저장소로 복사하고 커밋한다.
rem
rem   sync-from-project.cmd                  (기본 소스: ..\pobkr)
rem   sync-from-project.cmd "D:\work\pobkr"
rem
rem 복사 대상
rem   core\content.js      <- userscripts\poe-ninja-translation.user.js
rem   core\search-payload.js <- search-payload.js
rem   sites\ninja\         <- chrome-extension\
rem   pipeline\            <- scripts\, build_translation_map.py, build-all.cmd, package.json
rem   tools\               <- index.js, data-search.js, data-search.html, data-search-files.js
setlocal enabledelayedexpansion
set "DEST=%~dp0"
set "SRC=%~1"
if "%SRC%"=="" set "SRC=%~dp0..\pobkr"

if not exist "%SRC%\scripts\build_all.mjs" (
  echo [오류] 소스 프로젝트를 찾을 수 없습니다: "%SRC%"
  echo        사용법: sync-from-project.cmd "D:\work\pobkr"
  exit /b 1
)

echo 소스: "%SRC%"
echo 대상: "%DEST%"

if not exist "%DEST%core" mkdir "%DEST%core"
if not exist "%DEST%pipeline" mkdir "%DEST%pipeline"
if not exist "%DEST%tools" mkdir "%DEST%tools"
if not exist "%DEST%sites\ninja" mkdir "%DEST%sites\ninja"

copy /y "%SRC%\userscripts\poe-ninja-translation.user.js" "%DEST%core\content.js" >nul
copy /y "%SRC%\search-payload.js" "%DEST%core\search-payload.js" >nul
for %%F in (index.js data-search.js data-search.html data-search-files.js) do (
  if exist "%SRC%\%%F" copy /y "%SRC%\%%F" "%DEST%tools\%%F" >nul
)
for %%F in (build_translation_map.py build-all.cmd package.json) do (
  if exist "%SRC%\%%F" copy /y "%SRC%\%%F" "%DEST%pipeline\%%F" >nul
)
robocopy "%SRC%\scripts" "%DEST%pipeline\scripts" /MIR /NFL /NDL /NJH /NJS /NP >nul

if exist "%SRC%\chrome-extension" (
  robocopy "%SRC%\chrome-extension" "%DEST%sites\ninja" /MIR /NFL /NDL /NJH /NJS /NP >nul
  echo   sites\ninja  <- chrome-extension\  (복사됨)
) else (
  echo   sites\ninja  <- chrome-extension\  [!] 소스 폴더가 없어 건너뜀
)

cd /d "%DEST%"
git add -A
git -c user.name="%USERNAME%" -c user.email="%USERNAME%@localhost" commit -m "sync from project %DATE% %TIME%" >nul 2>nul
if errorlevel 1 (
  echo 커밋할 변경이 없다.
) else (
  echo 커밋 완료.
)
git remote >nul 2>nul
if errorlevel 1 (
  echo [안내] 리모트가 없습니다. 최초 1회:
  echo        git remote add origin https://github.com/jun1bh1/ninja_kr.git
  echo        git push -u origin master
) else (
  git push
)
endlocal
