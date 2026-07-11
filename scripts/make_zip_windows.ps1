$ErrorActionPreference = 'Stop'
$root = 'D:\AAA西南交大抢课系统\重写版自动抢课工具'
$release = Join-Path $root 'release\win32-x64'
$zip = Join-Path $root 'release\win32-x64.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $release '*') -DestinationPath $zip -Force
Write-Output $zip
