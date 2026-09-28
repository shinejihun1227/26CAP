param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'

function Get-StepOnPythonInfo {
  param([string]$Executable, [string[]]$PrefixArgs = @())
  # A launcher may exist without Python 3.12. Probe it before selecting it.
  $ErrorActionPreference = 'Continue'
  try {
    $probe = "import json,sys,struct; print(json.dumps({'executable':sys.executable,'version':list(sys.version_info[:3]),'bits':struct.calcsize('P')*8}))"
    $reply = & $Executable @PrefixArgs '-c' $probe 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $info = ($reply -join "`n") | ConvertFrom-Json -ErrorAction Stop
    if ($info.version[0] -ne 3 -or $info.version[1] -ne 12 -or $info.bits -ne 64) { return $null }
    return $info
  } catch { return $null }
}

function Find-StepOnPython {
  param([string]$Repo, [object[]]$Candidates)
  $venvPython = Join-Path $Repo '.venv-ai\Scripts\python.exe'
  if (Test-Path -LiteralPath $venvPython) {
    $info = Get-StepOnPythonInfo $venvPython
    if (-not $info) { throw 'Existing .venv-ai is not a working 64-bit Python 3.12 environment. Keep it intact and set up a fresh project folder.' }
    return $info
  }
  foreach ($candidate in $Candidates) {
    $info = Get-StepOnPythonInfo -Executable $candidate.Executable -PrefixArgs $candidate.PrefixArgs
    if ($info) { return $info }
  }
  throw '64-bit Python 3.12 was not found. Install Python 3.12, open a NEW PowerShell, then run setup-ai.bat from the project folder.'
}

function Invoke-StepOnAiSetup {
  param([switch]$CheckOnly)
  $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $candidates = @()
  foreach ($name in @('py.exe', 'python.exe', 'python3.exe')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) { continue }
    # Skip Windows Store python stubs, which can open a Store window.
    if ($name -ne 'py.exe' -and $command.Source -match '\\Microsoft\\WindowsApps\\python') { continue }
    $prefix = if ($name -eq 'py.exe') { @('-3.12') } else { @() }
    $candidates += @{ Executable = $command.Source; PrefixArgs = $prefix }
  }
  $knownPaths = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    (Join-Path $env:ProgramFiles 'Python312\python.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
  )
  foreach ($pythonPath in $knownPaths) {
    if (Test-Path -LiteralPath $pythonPath) { $candidates += @{ Executable = $pythonPath; PrefixArgs = @() } }
  }
  $info = Find-StepOnPython -Repo $repo -Candidates $candidates
  Write-Host ('Project folder: ' + $repo)
  Write-Host ('Python: ' + $info.executable + ' (' + ($info.version -join '.') + ', 64-bit)')
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $nodePath = if ($node) { $node.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
  if (Test-Path -LiteralPath $nodePath) { Write-Host ('Node: ' + $nodePath) }
  else { Write-Warning 'Node.js is not available. Install Node.js 24 and open a new PowerShell before running the web server.' }
  if ($CheckOnly) { Write-Host 'Python check passed. No environment or packages were changed.'; return }
  $venvDir = Join-Path $repo '.venv-ai'
  $venvPython = Join-Path $venvDir 'Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $venvPython)) {
    if (Test-Path -LiteralPath $venvDir) { throw 'An incomplete .venv-ai folder already exists. Use a fresh project folder or inspect that environment before retrying.' }
    & $info.executable -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
  }
  & $venvPython -m pip install -r (Join-Path $repo 'ai_engine\requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'AI dependency installation failed. Read the pip error above; the existing environment was not deleted.' }
  & $venvPython -m pip install --no-deps -e (Join-Path $repo 'ai_engine')
  if ($LASTEXITCODE -ne 0) { throw 'AI engine installation failed.' }
  Write-Host 'AI dependencies installed. Start run.bat.'
}

if ($MyInvocation.InvocationName -ne '.') {
  try { Invoke-StepOnAiSetup -CheckOnly:$CheckOnly }
  catch { Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
}
