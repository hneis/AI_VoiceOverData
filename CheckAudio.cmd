@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CheckAudio.ps1"
set "check_rc=%errorlevel%"
echo.
pause
exit /b %check_rc%
