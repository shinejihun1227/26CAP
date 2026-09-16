@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cap_web\tools\check-network.ps1" %*
set "STEPON_CHECK_EXIT=%ERRORLEVEL%"
pause
exit /b %STEPON_CHECK_EXIT%
