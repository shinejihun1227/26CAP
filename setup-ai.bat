@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--check" goto check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\ai_bridge\setup-ai.ps1"
exit /b %errorlevel%
:check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\ai_bridge\setup-ai.ps1" -CheckOnly
exit /b %errorlevel%
