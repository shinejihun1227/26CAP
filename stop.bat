@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cap_web\tools\stop-local.ps1"
if errorlevel 1 goto failed
echo StepOn servers from this folder have stopped. Saved files are preserved.
pause
exit /b 0
:failed
echo Stop was not completed. Finish any recording, calibration or CSV analysis first.
echo Check the message above. No forced shutdown is performed.
pause
exit /b 1
