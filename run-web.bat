@echo off
setlocal
cd /d "%~dp0"
set "STEPON_RESTART="
if /i "%~1"=="--restart" set "STEPON_RESTART=-Restart"
echo Starting StepOn web servers on 8000 and 8001. AI is separate.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cap_web\tools\start-local-web.ps1" %STEPON_RESTART%
if errorlevel 1 goto failed
start "" "http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=0&mobile=0"
echo Web: http://127.0.0.1:8000/
echo Editor: http://127.0.0.1:8001/?mode=editor
echo Run run-ai.bat to add AI, or use run.bat to open the full app.
echo Servers continue in the background. Use stop.bat when finished.
pause
exit /b 0
:failed
echo Web startup failed. Check the message above and docs\RUNNING.md.
pause
exit /b 1
