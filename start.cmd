@echo off
cd /d "%~dp0"
echo MTSLG Control ID Lookup GUI
echo   server: %~dp0server.js
echo   browser opens automatically; close this window to stop the server.
echo.
node server.js %*
echo.
echo Server exited with code %ERRORLEVEL%.
echo If it says node is not recognized, install Node.js (the plugin needs it too).
pause
