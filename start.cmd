@echo off
cd /d "%~dp0"
echo MasterGo Transcoder GUI
echo   version: 按 %~dp0current.json 选 versions\^<版本^>\，没有指针就用 %~dp0 这一份
echo   server : %~dp0server.js
echo   node   : 优先 runtime\node\current\node.exe（客户端自带那一份），其次 runtime\node\node.exe（旧布局），最后才用系统 PATH 里的 node
echo   browser opens automatically; close this window to stop the server.
echo.
set "MASTERGO_NODE=%~dp0runtime\node\current\node.exe"
if not exist "%MASTERGO_NODE%" set "MASTERGO_NODE=%~dp0runtime\node\node.exe"
if not exist "%MASTERGO_NODE%" set "MASTERGO_NODE=node"
"%MASTERGO_NODE%" launch.js %*
echo.
echo Server exited with code %ERRORLEVEL%.
echo If it says node is not recognized, install Node.js, or download it in the settings page.
pause
