param(
    [Parameter(Mandatory = $true)]
    [string]$Url,

    [Parameter(Mandatory = $false)]
    [string]$OutputDir,

    [Parameter(Mandatory = $false)]
    [string]$ShareName,

    [Parameter(Mandatory = $false)]
    [int]$TimeoutMs = 30000,

    [Parameter(Mandatory = $false)]
    [switch]$Headed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$skillRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Join-Path $skillRoot 'package.json'
$scriptPath = Join-Path $PSScriptRoot 'export-mockplus-testcases.mjs'

if (-not (Test-Path $packageJson)) {
    throw "Skill runtime config not found. Copy the full skill folder first: $packageJson"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20+ is required.'
}

if ([string]::IsNullOrWhiteSpace($Url)) {
    throw 'Must provide -Url. Current flow only supports manually provided share links.'
}

$args = @($scriptPath, '--timeout-ms', [string]$TimeoutMs)

if ($Url) {
    $args += @('--url', $Url)
}

if ($ShareName) {
    $args += @('--share-name', $ShareName)
}

if ($OutputDir) {
    $args += @('--output-dir', $OutputDir)
}

if ($Headed.IsPresent) {
    $args += '--headed'
}

& node @args
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Error 'Mockplus direct testcase export failed. If this is a new machine, run scripts/setup-runtime.ps1 first.'
    exit $exitCode
}
