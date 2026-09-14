@echo off
setlocal
title StepOn STA bilateral 8000 / 8001
cd /d "%~dp0"
set "STEPON_RESTART="
if /i "%~1"=="--restart" set "STEPON_RESTART=-Restart"
echo Starting StepOn web and AI. Already running services will be reused.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cap_web\tools\start-local-web.ps1" %STEPON_RESTART%
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\ai_bridge\start-ai.ps1" %STEPON_RESTART%
if errorlevel 1 goto failed
start "" "http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0"
start "" "http://127.0.0.1:8001/?mode=editor&screen=live"
echo CSV analysis: http://127.0.0.1:8000/data/
echo Servers run in the background. Use stop.bat when finished.
echo For live STA sensors, keep the 2.4GHz PC hotspot enabled.
echo After updating code, finish recordings and run: run.bat --restart
pause
exit /b 0
:failed
echo Server startup failed. See the message above; no unrelated process was stopped.
pause
exit /b 1
