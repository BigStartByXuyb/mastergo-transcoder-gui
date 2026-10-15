@echo off
cd /d "%~dp0"
echo MasterGo Transcoder GUI
echo   version: 按 %~dp0current.json 选 versions\^<版本^>\，没有指针就用 %~dp0 这一份
echo   server : %~dp0server.js
echo   node   : 优先 runtime\node\current\node.exe（客户端自带那一份），没有才用系统 PATH 里的 node
echo   browser opens automatically; close this window to stop the server.
echo.
:: 没有自带的 Node 时退回系统 PATH 里的 node：版本不受我们控制，所以把这句话打出来。
set "MASTERGO_NODE=%~dp0runtime\node\current\node.exe"
if not exist "%MASTERGO_NODE%" (
  echo 没有找到客户端自带的 Node，改用系统 PATH 里的 node。
  echo 要用自带那份：设置 -^> 更新 -^> 运行环境里下载；或在同一页允许使用系统上那两份。
  set "MASTERGO_NODE=node"
)
"%MASTERGO_NODE%" launch.js %*
echo.
echo Server exited with code %ERRORLEVEL%.
echo If it says node is not recognized, install Node.js, or download it in the settings page.
pause
