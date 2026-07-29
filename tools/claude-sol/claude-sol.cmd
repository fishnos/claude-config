@echo off
setlocal

set "SOL_LAUNCHER=%~dp0claude-sol.ps1"

where pwsh.exe >nul 2>&1
if %ERRORLEVEL%==0 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SOL_LAUNCHER%" %*
    exit /b %ERRORLEVEL%
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SOL_LAUNCHER%" %*
exit /b %ERRORLEVEL%
