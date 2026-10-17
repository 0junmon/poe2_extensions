@echo off
rem Runs the whole translation pipeline: scripts\build_all.mjs
rem
rem 기준 폴더(데이터: data\, translations\ 가 있는 폴더)를 정하는 순서
rem   1) 인자로 준 --root
rem   2) 이미 지정된 POBKR_ROOT
rem   3) 이 파일이 데이터 폴더에 있으면 그 폴더 (%~dp0)
rem   4) 코드 저장소 안(pipeline\)이면 옆의 데이터 폴더 (..\..\poe2_translation)
rem 코드 파일(확장/유저스크립트/도구)은 build_all.mjs 가 이 파일 위치 기준으로 찾는다.
setlocal
rem 콘솔에 한글이 깨져 보이지 않게 한다(표시만 바뀌고 결과에는 영향 없음).
chcp 65001 >nul
if not defined PYTHONIOENCODING set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"
if not defined POBKR_ROOT (
  if exist "%~dp0translations" (
    set "POBKR_ROOT=%~dp0"
  ) else if exist "%~dp0..\..\poe2_translation\translations" (
    set "POBKR_ROOT=%~dp0..\..\poe2_translation"
  ) else if exist "%~dp0..\poe2_translation\translations" (
    set "POBKR_ROOT=%~dp0..\poe2_translation"
  ) else (
    set "POBKR_ROOT=%~dp0"
  )
)
echo 기준 폴더: %POBKR_ROOT%
node "%~dp0scripts\build_all.mjs" %*
set "CODE=%ERRORLEVEL%"
if "%~1"=="" pause
endlocal & exit /b %CODE%
