param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scriptFile = Join-Path $PSScriptRoot 'server.py'
$pythonPath = Join-Path $repo '.venv-ai\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = Join-Path $repo '.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'AI environment missing. Run setup-ai.bat once, then run.bat.' }
$listener = Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($proc.Name -ne 'python.exe' -or -not $proc.CommandLine.Contains($scriptFile)) { throw 'Port 8787 is occupied by another process; it was not stopped.' }
  if (-not $Restart) { Write-Host 'StepOn AI already running.'; exit 0 }
  Stop-Process -Id $proc.ProcessId
  Wait-Process -Id $proc.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
}
$logs = Join-Path $repo '.codex-output'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Start-Process -FilePath $pythonPath -ArgumentList @('-u', "`"$scriptFile`"") -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'ai-8787.log') -RedirectStandardError (Join-Path $logs 'ai-8787.error.log') | Out-Null
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8787/api/ai/state' -TimeoutSec 1
    if ($health.service -eq 'stepon-ai-bridge' -and $health.api_version -eq 2) { Write-Host 'StepOn AI ready. Configure personal IMU calibration in the web analysis screen.'; exit 0 }
  } catch { }
  Start-Sleep -Milliseconds 500
}
throw 'AI startup failed. Check .codex-output/ai-8787.error.log.'
