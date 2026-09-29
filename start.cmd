@echo off
cd /d "%~dp0"
echo MasterGo Transcoder GUI
echo   version: 按 %~dp0current.json 选 versions\^<版本^>\，没有指针就用 %~dp0 这一份
echo   server : %~dp0server.js
echo   browser opens automatically; close this window to stop the server.
echo.
node launch.js %*
echo.
echo Server exited with code %ERRORLEVEL%.
echo If it says node is not recognized, install Node.js (the plugin needs it too).
pause
