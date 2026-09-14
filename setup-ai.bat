@echo off
setlocal
cd /d "%~dp0"
if exist ".venv-ai\Scripts\python.exe" goto install
where py >nul 2>nul
if not errorlevel 1 (
  py -3.12 -m venv .venv-ai
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -m venv .venv-ai
  ) else (
    if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
      "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m venv .venv-ai
    ) else (
      echo Install Python 3.12 first.
      exit /b 1
    )
  )
)
if errorlevel 1 exit /b 1
:install
.venv-ai\Scripts\python.exe -m pip install -r ai_engine\requirements.txt
if errorlevel 1 exit /b 1
.venv-ai\Scripts\python.exe -m pip install --no-deps -e ai_engine
if errorlevel 1 exit /b 1
echo AI dependencies installed. Start run.bat.
exit /b 0
