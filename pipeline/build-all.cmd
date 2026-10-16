@echo off
rem Runs the whole translation pipeline: scripts\build_all.mjs
rem 이 .cmd 가 있는 폴더가 기준(base)이 된다. 다른 폴더를 기준으로 삼으려면
rem 실행 전에 POBKR_ROOT 를 지정하거나 `build-all.cmd --root "D:\path"` 로 실행한다.
cd /d "%~dp0"
if not defined POBKR_ROOT set "POBKR_ROOT=%~dp0"
node "%~dp0scripts\build_all.mjs" %*
set "CODE=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %CODE%
