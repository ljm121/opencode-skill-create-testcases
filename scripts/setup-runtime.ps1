Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$skillRoot = Split-Path -Parent $scriptDir
$packageJson = Join-Path $skillRoot 'package.json'
$verifyScript = Join-Path $scriptDir 'verify-runtime.mjs'

if (-not (Test-Path $packageJson)) {
    throw "Skill runtime config not found: $packageJson"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20+ is required.'
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    & $Action
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "$Name failed with exit code $exitCode."
        Write-Error 'If you see unknown certificate verification error, this machine likely needs corporate CA / proxy configuration for npm and Node.js.'
        Write-Error 'Recommended checks: npm config get cafile, npm config get proxy, npm config get https-proxy, and NODE_EXTRA_CA_CERTS.'
        Write-Error 'Then rerun scripts/setup-runtime.ps1 after fixing the certificate trust chain.'
        exit $exitCode
    }
}

Invoke-Step -Name 'npm install' -Action { npm install --prefix $skillRoot }
Invoke-Step -Name 'playwright browser install' -Action { npx --prefix $skillRoot playwright install chromium }

& node $verifyScript
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    exit $exitCode
}
