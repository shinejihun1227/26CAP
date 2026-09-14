@echo off
setlocal
set "STEPON_PY_EXE="
set "STEPON_PY_FLAGS="
where py >nul 2>nul
if not errorlevel 1 (
  set "STEPON_PY_EXE=py"
  set "STEPON_PY_FLAGS=-3"
  goto found
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "STEPON_PY_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  goto found
)
where python >nul 2>nul
if not errorlevel 1 (
  set "STEPON_PY_EXE=python"
  goto found
)
echo Python 3.10 or newer is required. Install Python and reopen this file.
pause
exit /b 2
:found
if /i "%~1"=="--install" (
  "%STEPON_PY_EXE%" %STEPON_PY_FLAGS% -m pip install --target "%~dp0.deps" -r "%~dp0requirements.txt"
) else (
  "%STEPON_PY_EXE%" %STEPON_PY_FLAGS% -X utf8 "%~dp0record_csv.py" %*
)
set "STEPON_RECORD_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %STEPON_RECORD_EXIT%
