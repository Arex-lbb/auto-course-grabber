@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make_zip_windows.ps1"
