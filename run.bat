@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not on PATH. Install Node.js, reopen the terminal, and retry.
  pause
  exit /b 1
)
node scripts/run-web.mjs
if errorlevel 1 pause
