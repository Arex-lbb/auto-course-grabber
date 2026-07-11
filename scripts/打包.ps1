
# 自动抢课系统 - 打包脚本
# 用法: 右键 → 使用 PowerShell 运行，或在终端执行 .\打包.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$release = Join-Path $root "release\win32-x64"
$zipOut = Join-Path $root "release\SWJTU-抢课系统-绿色版.zip"

Write-Host "=== 自动抢课系统 打包脚本 ===" -ForegroundColor Cyan

# 1. Build
Write-Host "[1/5] Building with Vite..." -ForegroundColor Yellow
Set-Location $root
npx vite build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
Write-Host "  Build OK" -ForegroundColor Green

# 2. Copy dist
Write-Host "[2/5] Copying dist..." -ForegroundColor Yellow
$distTarget = Join-Path $release "dist"
if (Test-Path $distTarget) { Remove-Item $distTarget -Recurse -Force }
Copy-Item (Join-Path $root "dist") $distTarget -Recurse

# Fix index.html
$html = Get-Content (Join-Path $distTarget "index.html") -Raw
$html = $html -replace 'type="module" ', '' -replace ' crossorigin', ''
Set-Content (Join-Path $distTarget "index.html") $html -NoNewline

# 3. Sync source files
Write-Host "[3/5] Syncing source files..." -ForegroundColor Yellow
$srcTarget = Join-Path $release "src\main"
New-Item $srcTarget -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $root "src\main\*.js") $srcTarget -Force
Copy-Item (Join-Path $root "electron\main.js") (Join-Path $release "electron\main.js") -Force
Copy-Item (Join-Path $root "electron\preload.js") (Join-Path $release "electron\preload.js") -Force
Copy-Item (Join-Path $root "package.json") $release -Force

# 4. Create launchers
Write-Host "[4/5] Creating launchers..." -ForegroundColor Yellow
# (launchers already created by build process)

# 5. Verify
Write-Host "[5/5] Verifying..." -ForegroundColor Yellow
$electron = Join-Path $release "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) { Write-Host "  ERROR: electron.exe not found! Run npm install first." -ForegroundColor Red; exit 1 }
Write-Host "  Package verified" -ForegroundColor Green

Write-Host ""
Write-Host "=== PACKAGE READY ===" -ForegroundColor Green
Write-Host "Location: $release"
Write-Host ""
Write-Host "To distribute:" -ForegroundColor Cyan
Write-Host "  1. Compress the folder: $release → SWJTU-抢课系统-绿色版.zip"
Write-Host "  2. Send the zip to others"
Write-Host "  3. They extract and double-click 启动.vbs"
Write-Host ""
Write-Host "Note: The zip will be ~200MB (includes Electron runtime)"
