@echo off
setlocal
cd /d "%~dp0"
set "STEPON_RESTART="
if /i "%~1"=="--restart" set "STEPON_RESTART=-Restart"
echo Starting the StepOn AI service on 8787. Run setup-ai.bat once first.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\ai_bridge\start-ai.ps1" %STEPON_RESTART%
if errorlevel 1 goto failed
echo Keep the web server running too. Open the AI-enabled page:
echo http://127.0.0.1:8000/?view=safety^&esp32=1^&transport=sta^&ai=1
echo CSV: http://127.0.0.1:8000/data/
echo Use stop.bat when finished.
pause
exit /b 0
:failed
echo AI startup failed. Check the message above and README.md.
pause
exit /b 1
