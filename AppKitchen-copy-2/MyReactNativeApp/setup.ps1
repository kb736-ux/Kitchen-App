# Setup script: install dependencies for AppKitchen (Expo web + mobile)
# Run from PowerShell: .\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host "AppKitchen - Dependency setup" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js (npm)
$npmPath = $null
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmPath = "npm"
}
if (-not $npmPath -and (Test-Path "$env:ProgramFiles\nodejs\npm.cmd")) {
    $npmPath = "$env:ProgramFiles\nodejs\npm.cmd"
}
if (-not $npmPath -and (Test-Path "${env:ProgramFiles(x86)}\nodejs\npm.cmd")) {
    $npmPath = "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
}

if (-not $npmPath) {
    Write-Host "Node.js was not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "1. Download and install Node.js (LTS) from: https://nodejs.org" -ForegroundColor Yellow
    Write-Host "2. Restart this terminal (and Cursor if needed)." -ForegroundColor Yellow
    Write-Host "3. Run this script again: .\setup.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "Node.js found. Installing dependencies..." -ForegroundColor Green
Write-Host ""

& $npmPath install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Install failed. Check the messages above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Run the app:" -ForegroundColor Cyan
Write-Host "  Web:      npm run web" -ForegroundColor White
Write-Host "  Android:  npm run android" -ForegroundColor White
Write-Host "  iOS:      npm run ios" -ForegroundColor White
Write-Host "  Dev menu: npm start" -ForegroundColor White
Write-Host ""
