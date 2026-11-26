@echo off
setlocal
cd /d "%~dp0"
title GreenSim preview server

echo.
echo ========================================
echo GreenSim local preview
echo ========================================
echo.
echo Project folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "tools\serve.js" goto no_server_file
if not exist "tools\build-preview.cjs" goto no_build_file

echo [1/2] Building index.html...
node tools\build-preview.cjs
if errorlevel 1 goto build_failed

echo.
echo [2/2] Starting local server...
echo.
echo Open this address in your browser:
echo http://localhost:8080/
echo.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
node tools\serve.js
echo.
echo Server process has stopped.
pause
exit /b

:no_node
echo ERROR: Node.js was not found in PATH.
goto failed

:no_server_file
echo ERROR: tools\serve.js is missing.
goto failed

:no_build_file
echo ERROR: tools\build-preview.cjs is missing.
goto failed

:build_failed
echo ERROR: Build failed. See the message above.
goto failed

:failed
echo.
echo Press any key to close this window.
pause >nul
