param(
  [Parameter(Mandatory = $true)]
  [string]$Calibration,
  [string]$Esp32Url = "http://192.168.4.1",
  [ValidateSet("rf", "cnn", "ensemble")]
  [string]$Model = "ensemble",
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8787
)

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pythonPath = Join-Path $repositoryRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = "python" }

& $pythonPath (Join-Path $PSScriptRoot "server.py") `
  --esp32-url $Esp32Url `
  --calibration $Calibration `
  --model $Model `
  --host $HostAddress `
  --port $Port
