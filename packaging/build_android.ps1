[CmdletBinding()]
param(
    [switch]$Offline,
    [string]$JavaHome,
    [string]$AndroidSdk,
    [string]$DebugKeystore
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$gradleConfig = Get-Content -LiteralPath (Join-Path $androidRoot 'app/build.gradle') -Raw
$versionCodeMatches = [regex]::Matches($gradleConfig, '(?m)^\s*versionCode\s+(\d+)\s*$')
$versionNameMatches = [regex]::Matches($gradleConfig, "(?m)^\s*versionName\s+'([^']+)'\s*$")
if ($versionCodeMatches.Count -ne 1 -or $versionNameMatches.Count -ne 1) {
    throw 'Exactly one literal versionCode and versionName are required in android/app/build.gradle for APK verification.'
}
$expectedVersionCode = $versionCodeMatches[0].Groups[1].Value
$expectedVersionName = $versionNameMatches[0].Groups[1].Value

function Find-JavaHome {
    $candidates = @($JavaHome, $env:JAVA_HOME)
    $localJdks = Join-Path $env:USERPROFILE '.jdks'
    if (Test-Path -LiteralPath $localJdks -PathType Container) {
        $candidates += Get-ChildItem -LiteralPath $localJdks -Directory | Select-Object -ExpandProperty FullName
    }
    $javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($javaCommand) { $candidates += Split-Path -Parent (Split-Path -Parent $javaCommand.Source) }
    $registryRoots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($registryRoot in $registryRoots) {
        foreach ($entry in (Get-ItemProperty -Path "$registryRoot\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Android Studio' })) {
            if ($entry.InstallLocation) { $candidates += Join-Path $entry.InstallLocation 'jbr' }
            if ($entry.DisplayIcon) {
                $studioExe = ($entry.DisplayIcon -replace ',\d+$', '').Trim('"')
                $candidates += Join-Path (Split-Path -Parent (Split-Path -Parent $studioExe)) 'jbr'
            }
        }
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe') -PathType Leaf)) {
            $releaseFile = Join-Path $candidate 'release'
            if (Test-Path -LiteralPath $releaseFile) {
                $javaVersion = [regex]::Match((Get-Content -LiteralPath $releaseFile -Raw), 'JAVA_VERSION="(\d+)')
                if ($javaVersion.Success -and [int]$javaVersion.Groups[1].Value -ge 17 -and [int]$javaVersion.Groups[1].Value -le 23) {
                    return (Resolve-Path -LiteralPath $candidate).Path
                }
            }
        }
    }
    throw 'A JDK compatible with Gradle 8.13 was not found. Use JDK 17 or 21 and set JAVA_HOME (or pass -JavaHome).'
}

function Find-AndroidSdk {
    foreach ($candidate in @($AndroidSdk, $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android/Sdk'))) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'platforms/android-36/android.jar') -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Android SDK platform 36 was not found. Install it in Android Studio and set ANDROID_HOME (or pass -AndroidSdk).'
}

$resolvedJava = Find-JavaHome
$resolvedSdk = Find-AndroidSdk
if (!$DebugKeystore) { $DebugKeystore = $env:SQUARE_DRILLS_DEBUG_KEYSTORE }
if (!$DebugKeystore) { $DebugKeystore = Join-Path $env:USERPROFILE '.android/debug.keystore' }
if (!(Test-Path -LiteralPath $DebugKeystore -PathType Leaf)) {
    throw 'An existing Android debug keystore is required. Pass -DebugKeystore or set SQUARE_DRILLS_DEBUG_KEYSTORE. No signing key has been created.'
}
$resolvedKey = (Resolve-Path -LiteralPath $DebugKeystore).Path
$buildTools = Get-ChildItem -LiteralPath (Join-Path $resolvedSdk 'build-tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'aapt.exe')) } |
    Select-Object -First 1
if (!$buildTools) { throw 'Android SDK Build Tools with aapt and apksigner are required.' }

$python = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if (!$pythonCommand) { $pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue }
    if (!$pythonCommand) { throw 'Python is required to sync the shared frontend assets. Install Python or run the project setup first.' }
    $python = $pythonCommand.Source
}
& $python (Join-Path $projectRoot 'scripts/sync_android_assets.py')
if ($LASTEXITCODE -ne 0) { throw 'Shared Android asset sync failed.' }

$previousJava = $env:JAVA_HOME
$previousSdk = $env:ANDROID_HOME
$previousKey = $env:SQUARE_DRILLS_DEBUG_KEYSTORE
$previousGradle = $env:GRADLE_USER_HOME
try {
    $env:JAVA_HOME = $resolvedJava
    $env:ANDROID_HOME = $resolvedSdk
    $env:SQUARE_DRILLS_DEBUG_KEYSTORE = $resolvedKey
    if (!$env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE '.gradle' }
    Push-Location -LiteralPath $androidRoot
    try {
        $gradleArgs = @('--no-daemon', '--console=plain')
        if ($Offline) { $gradleArgs += '--offline' }
        $gradleArgs += @('testDebugUnitTest', 'lintDebug', 'assembleDebug')
        & (Join-Path $androidRoot 'gradlew.bat') @gradleArgs
        if ($LASTEXITCODE -ne 0) { throw 'Android tests, lint, or build failed. The canonical APK was not replaced.' }
    } finally { Pop-Location }

    $builtApk = Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk'
    if (!(Test-Path -LiteralPath $builtApk -PathType Leaf)) { throw 'Gradle did not produce the expected APK.' }
    $signerOutput = & (Join-Path $buildTools.FullName 'apksigner.bat') verify --print-certs $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $signerMatch = [regex]::Match(($signerOutput -join "`n"), 'Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)')
    if (!$signerMatch.Success) { throw 'The APK signer fingerprint could not be verified.' }
    $keyOutput = & (Join-Path $resolvedJava 'bin/keytool.exe') '-J-Duser.language=en' -list -v -keystore $resolvedKey -storepass android -alias androiddebugkey
    if ($LASTEXITCODE -ne 0) { throw 'The existing debug signing identity could not be verified.' }
    $keyMatch = [regex]::Match(($keyOutput -join "`n"), 'SHA256:\s*([0-9a-fA-F:]+)')
    if (!$keyMatch.Success -or $keyMatch.Groups[1].Value.Replace(':', '') -ine $signerMatch.Groups[1].Value) {
        throw 'The APK signature does not match the existing debug identity.'
    }

    $badging = & (Join-Path $buildTools.FullName 'aapt.exe') dump badging $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed.' }
    $manifestText = $badging -join "`n"
    $packageMatch = [regex]::Match($manifestText, "(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
    if (!$packageMatch.Success -or $packageMatch.Groups[1].Value -cne 'com.codeguy.squaredrills' -or
        $packageMatch.Groups[2].Value -cne $expectedVersionCode -or $packageMatch.Groups[3].Value -cne $expectedVersionName -or
        $manifestText -notmatch "sdkVersion:'26'" -or $manifestText -notmatch "application-label:'Square Drills'") {
        throw 'APK identity, version, minimum Android version, or display name is incorrect.'
    }
    if ($manifestText -match '(?m)^uses-permission') { throw 'The APK unexpectedly requests permissions.' }
    $manifestTree = & (Join-Path $buildTools.FullName 'aapt.exe') dump xmltree $builtApk AndroidManifest.xml
    if ($LASTEXITCODE -ne 0) { throw 'APK backup policy inspection failed.' }
    foreach ($attribute in @('allowBackup', 'fullBackupContent', 'usesCleartextTraffic')) {
        if (($manifestTree -join "`n") -notmatch "android:$attribute\([^\r\n]+\)=\(type 0x12\)0x0") {
            throw "APK policy does not disable $attribute."
        }
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($builtApk)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName })
        foreach ($required in @('classes.dex', 'AndroidManifest.xml', 'assets/static/index.html', 'assets/static/js/android-api.js', 'assets/static/js/mobile.js', 'assets/static/js/modules/square-drills-core.js', 'assets/static/js/modules/square-drills.js')) {
            if ($required -notin $entries) { throw "APK is missing $required" }
        }
        if ($entries | Where-Object { $_ -match '\.(db|db-wal|db-shm|sqlite|jks|keystore|log)$|local\.properties$' }) {
            throw 'The APK contains private runtime files or signing material.'
        }
        if ($entries | Where-Object { $_ -match 'assets/.*(match-tracker|score-percentage|steps-grade|local-calculations|ccd-)' }) {
            throw 'The APK contains an unrelated suite module.'
        }
        $assetsRoot = Join-Path $androidRoot 'app/src/main/assets'
        foreach ($sourceAsset in (Get-ChildItem -LiteralPath (Join-Path $assetsRoot 'static') -File -Recurse)) {
            $relativeAsset = $sourceAsset.FullName.Substring($assetsRoot.Length + 1).Replace('\', '/')
            $entry = $archive.GetEntry("assets/$relativeAsset")
            if (!$entry) { throw "APK is missing the source asset $relativeAsset" }
            $entryStream = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $assetHash = [System.BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-', '') }
            finally { $entryStream.Dispose(); $sha.Dispose() }
            if ($assetHash -ne (Get-FileHash -LiteralPath $sourceAsset.FullName -Algorithm SHA256).Hash) {
                throw "APK asset differs from current source: $relativeAsset. Rerun the build after source edits finish."
            }
        }
    } finally { $archive.Dispose() }

    $distribution = Join-Path $androidRoot 'dist'
    New-Item -ItemType Directory -Path $distribution -Force | Out-Null
    $canonicalApk = Join-Path $distribution 'SquareDrills.apk'
    if (Test-Path -LiteralPath $canonicalApk) {
        try {
            $lockCheck = [System.IO.File]::Open($canonicalApk, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            $lockCheck.Dispose()
        } catch { throw 'The canonical APK is locked. Close the program using it and rerun this build; no alternate release was created.' }
    }
    Copy-Item -LiteralPath $builtApk -Destination $canonicalApk -Force
    $builtHash = (Get-FileHash -LiteralPath $builtApk -Algorithm SHA256).Hash
    $publishedHash = (Get-FileHash -LiteralPath $canonicalApk -Algorithm SHA256).Hash
    if ($builtHash -ne $publishedHash) { throw 'Canonical APK hash verification failed.' }
    Write-Output "Verified debug APK: $canonicalApk"
    Write-Output "Version: $expectedVersionName (code $expectedVersionCode)"
    Write-Output "SHA-256: $publishedHash"
    Write-Output "Signer SHA-256: $($signerMatch.Groups[1].Value)"
} finally {
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousSdk
    $env:SQUARE_DRILLS_DEBUG_KEYSTORE = $previousKey
    $env:GRADLE_USER_HOME = $previousGradle
}
