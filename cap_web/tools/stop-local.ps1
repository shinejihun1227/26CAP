param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$targets = @(
  @{ Port = 8787; Name = 'python.exe'; Script = (Join-Path $repo 'web\ai_bridge\server.py') },
  @{ Port = 8001; Name = 'node.exe'; Script = (Join-Path $repo 'cap_web\dev-server.mjs') },
  @{ Port = 8000; Name = 'node.exe'; Script = (Join-Path $repo 'cap_web\dev-server.mjs') }
)
$verified = @()
# Complete all ownership/activity checks before stopping any process.
foreach ($target in $targets) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $target.Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { continue }
  $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $scriptPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($target.Script) + '"?(?:\s|$)'
  if ($running.Name -ne $target.Name -or $running.CommandLine -notmatch $scriptPattern) {
    throw "Port $($target.Port) belongs to another or unverified process. Nothing was stopped."
  }
  $verified += [pscustomobject]@{ Port = $target.Port; ProcessId = $running.ProcessId; CreationDate = $running.CreationDate; Pattern = $scriptPattern; Name = $target.Name }
}
if ($verified | Where-Object { $_.Port -eq 8787 }) {
  $jobs = Invoke-RestMethod 'http://127.0.0.1:8787/api/ai/datasets' -TimeoutSec 3
  $ai = Invoke-RestMethod 'http://127.0.0.1:8787/api/ai/state' -TimeoutSec 3
  if ($jobs.active_recording -or $jobs.active_job) { throw 'Finish the CSV recording or analysis on /data/ before stopping. Nothing was stopped.' }
  foreach ($side in @('left', 'right')) {
    if ($ai.feet.$side.capture.status -in @('countdown', 'recording')) { throw 'Finish or cancel personal IMU calibration before stopping. Nothing was stopped.' }
  }
}
foreach ($target in $verified) {
  if ($CheckOnly) { Write-Host "Verified StepOn port $($target.Port), PID $($target.ProcessId)."; continue }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)"
  if (-not $current) { continue }
  if ($current.CreationDate -ne $target.CreationDate -or $current.Name -ne $target.Name -or $current.CommandLine -notmatch $target.Pattern) {
    throw "Process identity changed on port $($target.Port); it was not stopped."
  }
  Stop-Process -Id $target.ProcessId
  Wait-Process -Id $target.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  Write-Host "Stopped StepOn port $($target.Port)."
}
if (-not $verified.Count) { Write-Host 'No StepOn servers from this folder are running.' }
