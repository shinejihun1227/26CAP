param(
  [string]$Calibration = '',
  [string]$Esp32Url = '',
  [string]$HubUrl = 'http://127.0.0.1:8000',
  [ValidateSet('left', 'right')][string]$Foot = 'right',
  [ValidateSet('rf', 'cnn', 'ensemble')][string]$Model = 'ensemble',
  [string]$HostAddress = '127.0.0.1',
  [int]$Port = 8787
)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$pythonPath = Join-Path $repositoryRoot '.venv-ai\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = Join-Path $repositoryRoot '.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run setup-ai.bat first.' }
$bridgeArgs = @((Join-Path $PSScriptRoot 'server.py'), '--hub-url', $HubUrl, '--foot', $Foot, '--model', $Model, '--host', $HostAddress, '--port', "$Port")
if ($Esp32Url) { $bridgeArgs += @('--esp32-url', $Esp32Url) }
if ($Calibration) { $bridgeArgs += @('--calibration', $Calibration) }
& $pythonPath @bridgeArgs
exit $LASTEXITCODE
