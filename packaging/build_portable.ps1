$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$buildRoot = Join-Path $projectRoot 'build'
$stagingRoot = Join-Path $buildRoot 'portable-staging'
$stagingApp = Join-Path $stagingRoot 'Square Drills'
$destination = Join-Path $projectRoot 'dist\Square Drills'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$specification = Join-Path $PSScriptRoot 'square_drills.spec'

function Assert-AppStopped {
    # Enumerating all processes distinguishes a failed check from no match.
    $running = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'Square Drills' })
    if ($running.Count -gt 0) { throw 'Square Drills is running. Close it before rebuilding.' }
}

function Assert-Directory([string]$Path, [string]$Expected) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ($resolved -ne $Expected -or -not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar) -or
        ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to modify unexpected directory: $resolved"
    }
    $links = @(Get-ChildItem -LiteralPath $Path -Force -Recurse | Where-Object {
        $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    })
    if ($links.Count -gt 0) { throw "Refusing to modify directory containing a reparse point: $resolved" }
}

function Invoke-SmokeTest([string]$Executable, [string]$Report) {
    $process = Start-Process -FilePath $Executable -ArgumentList @('--smoke-test', '--smoke-report', ('"' + $Report + '"')) -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $Report)) {
        throw "Packaged smoke test failed; inspect $Report"
    }
    $result = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
    if (-not $result.ok) { throw "Packaged smoke test failed; inspect $Report" }
}

Assert-AppStopped
if (-not (Test-Path -LiteralPath $python)) { throw 'Run setup.bat first.' }
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
Assert-Directory $buildRoot $buildRoot
if (Test-Path -LiteralPath $stagingRoot) {
    Assert-Directory $stagingRoot $stagingRoot
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

$priorCache = $env:PYINSTALLER_CONFIG_DIR
try {
    $env:PYINSTALLER_CONFIG_DIR = Join-Path $buildRoot 'pyinstaller-cache'
    & $python -m unittest discover -s (Join-Path $projectRoot 'tests') -v
    if ($LASTEXITCODE -ne 0) { throw 'Windows regression tests failed.' }
    & $python -m PyInstaller --noconfirm --workpath (Join-Path $buildRoot 'pyinstaller') --distpath $stagingRoot $specification
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }
} finally {
    $env:PYINSTALLER_CONFIG_DIR = $priorCache
}

$stagedExe = Join-Path $stagingApp 'Square Drills.exe'
if (-not (Test-Path -LiteralPath $stagedExe)) { throw 'The staged executable was not created.' }
Invoke-SmokeTest $stagedExe (Join-Path $buildRoot 'windows-staged-smoke.json')
$privateFiles = @(Get-ChildItem -LiteralPath $stagingApp -Recurse -Force | Where-Object {
    $_.Name -match '\.(db|db-wal|db-shm|log|keystore|jks)$' -or ($_.PSIsContainer -and $_.Name -in @('data', 'webview-profile', '.git', '.venv'))
})
if ($privateFiles.Count -gt 0) { throw 'The compiler output contains unexpected private runtime files.' }

# Archive clean compiler output only. Never archive the owner's live data folder.
$stagedArchive = Join-Path $stagingRoot 'SquareDrills-portable.zip'
Compress-Archive -LiteralPath $stagingApp -DestinationPath $stagedArchive -CompressionLevel Optimal

Assert-AppStopped
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Assert-Directory (Split-Path -Parent $destination) (Join-Path $projectRoot 'dist')
Assert-Directory $destination $destination
$bundledRuntime = Join-Path $destination '_internal'
$installedExe = Join-Path $destination 'Square Drills.exe'
# Check existing executable/runtime locks before replacing any program files.
$programFiles = @()
if (Test-Path -LiteralPath $installedExe) { $programFiles += Get-Item -LiteralPath $installedExe }
if (Test-Path -LiteralPath $bundledRuntime) {
    Assert-Directory $bundledRuntime $bundledRuntime
    $programFiles += Get-ChildItem -LiteralPath $bundledRuntime -File -Recurse -Force
}
foreach ($file in $programFiles) {
    try {
        $handle = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $handle.Dispose()
    } catch { throw "Application files are locked. Close Square Drills before updating. Locked file: $($file.Name)" }
}
Assert-AppStopped
if (Test-Path -LiteralPath $bundledRuntime) { Remove-Item -LiteralPath $bundledRuntime -Recurse -Force }
Get-ChildItem -LiteralPath $stagingApp -Force | Copy-Item -Destination $destination -Recurse -Force
Move-Item -LiteralPath $stagedArchive -Destination (Join-Path $projectRoot 'dist\SquareDrills-portable.zip') -Force
Assert-Directory $stagingRoot $stagingRoot
Remove-Item -LiteralPath $stagingRoot -Recurse -Force
Invoke-SmokeTest $installedExe (Join-Path $buildRoot 'windows-canonical-smoke.json')
Write-Host "Portable application verified in $destination"
