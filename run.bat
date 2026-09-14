@echo off
setlocal
title StepOn STA bilateral 8000 / 8001
cd /d "%~dp0"
echo Restarting verified StepOn web servers. Other Node processes are left alone.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cap_web\tools\start-local-web.ps1" -Restart
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\ai_bridge\start-ai.ps1" -Restart
if errorlevel 1 goto failed
start "" "http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0"
start "" "http://127.0.0.1:8001/?mode=editor&screen=live"
echo Servers run in the background. Keep the 2.4GHz PC hotspot enabled.
pause
exit /b 0
:failed
echo Server startup failed. See the message above; no unrelated process was stopped.
pause
exit /b 1
