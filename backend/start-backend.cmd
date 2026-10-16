@echo off
setlocal
cd /d "%~dp0"
if not defined DATA_DIR set "DATA_DIR=%LOCALAPPDATA%\TurtleTogetherBackend\data"
if not defined HOST set "HOST=127.0.0.1"
set "PORT=4173"
"%~dp0..\windows\runtime\node.exe" "%~dp0server.mjs"
pause