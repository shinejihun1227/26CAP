param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$webRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverFile = Join-Path $webRoot 'dev-server.mjs'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found. Install Node.js 20+ or use the bundled runtime.' }
$logRoot = Join-Path ([IO.Path]::GetFullPath((Join-Path $webRoot '..'))) '.codex-output'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
foreach ($webPort in @(8000, 8001)) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $webPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    $isOurServer = $false
    if ($serverProcess.Name -eq 'node.exe' -and $serverProcess.CommandLine -match 'dev-server\.mjs') {
      try {
        # Verify the serving workspace before stopping any process. Never kill all Node processes.
        $served = (Invoke-WebRequest "http://127.0.0.1:$webPort/src/components/insole-connection.js" -UseBasicParsing -TimeoutSec 2).Content
        if ($served -is [byte[]]) { $served = [Text.Encoding]::UTF8.GetString($served) }
        $local = Get-Content -LiteralPath (Join-Path $webRoot 'src/components/insole-connection.js') -Raw -Encoding UTF8
        $isOurServer = $served.Trim() -eq $local.Trim()
      } catch { $isOurServer = $false }
    }
    if (-not $isOurServer) { throw "Port $webPort is occupied by an unverified process. It was NOT stopped. Close it manually or use another port." }
    if (-not $Restart) { Write-Host "StepOn $webPort already running."; continue }
    Stop-Process -Id $serverProcess.ProcessId
    Wait-Process -Id $serverProcess.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }
  Start-Process -FilePath $nodePath -ArgumentList @("`"$serverFile`"", "$webPort", '0.0.0.0') -WorkingDirectory $webRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "web-$webPort.log") -RedirectStandardError (Join-Path $logRoot "web-$webPort.error.log") | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$webPort/api/insoles/state" -TimeoutSec 1
      if ($health.service -eq 'stepon-bilateral-v1') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 200
  }
  if (-not $ready) { throw "StepOn $webPort did not start. Check .codex-output/web-$webPort.error.log" }
  Write-Host "StepOn $webPort ready."
}
Write-Host 'STA insoles: http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0'
Write-Host 'Keep this PC hotspot on 2.4GHz. Sensor polling starts only after device registration.'
