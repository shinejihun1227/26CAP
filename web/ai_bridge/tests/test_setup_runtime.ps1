param([Parameter(Mandatory=$true)][string]$PythonExe)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\setup-ai.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('stepon-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$broken = Join-Path $fixture 'missing runtime.cmd'
$wrong = Join-Path $fixture 'wrong version.cmd'
$narrow = Join-Path $fixture 'python32.cmd'
try {
  [IO.File]::WriteAllText($broken, "@echo off`r`nexit /b 1`r`n")
  [IO.File]::WriteAllText($wrong, "@echo off`r`necho {`"executable`":`"unused`",`"version`":[3,13,0],`"bits`":64}`r`nexit /b 0`r`n")
  [IO.File]::WriteAllText($narrow, "@echo off`r`necho {`"executable`":`"unused`",`"version`":[3,12,0],`"bits`":32}`r`nexit /b 0`r`n")
  $info = Find-StepOnPython -Repo $fixture -Candidates @(
    @{Executable=$broken; PrefixArgs=@('-3.12')},
    @{Executable=$wrong; PrefixArgs=@()},
    @{Executable=$narrow; PrefixArgs=@()},
    @{Executable=$PythonExe; PrefixArgs=@()}
  )
  if ($info.version[1] -ne 12 -or $info.bits -ne 64) { throw 'Fallback did not select compatible Python.' }
  if (Get-StepOnPythonInfo $wrong) { throw 'Python 3.13 was accepted.' }
  if (Get-StepOnPythonInfo $narrow) { throw '32-bit Python was accepted.' }
  $missingRejected = $false
  try { Find-StepOnPython -Repo $fixture -Candidates @(@{Executable=$broken; PrefixArgs=@('-3.12')}) | Out-Null }
  catch { if ($_.Exception.Message -notlike '*Python 3.12 was not found*') { throw }; $missingRejected = $true }
  if (-not $missingRejected) { throw 'Missing runtime was not rejected.' }
  Write-Host 'PASS: launcher failure fallback, Python version, 64-bit check, missing-runtime message. No installation performed.'
} finally {
  foreach ($file in @($broken,$wrong,$narrow)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture }
}
