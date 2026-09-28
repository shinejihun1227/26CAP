$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$serverFile = Join-Path $PSScriptRoot 'server.py'

if ($null -ne $pythonCommand) {
    & $pythonCommand.Source $serverFile
    exit $LASTEXITCODE
}

$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $bundledPython)) {
    throw 'Python을 찾지 못했습니다. Python 3.10 이상을 설치하거나 README의 실행 경로를 확인하세요.'
}

& $bundledPython $serverFile
exit $LASTEXITCODE
