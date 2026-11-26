@echo off
setlocal
REM Запуск через отдельный CMD с /k гарантирует, что окно не закроется.
if /i not "%~1"=="--run" (
  start "GreenSim preview server" cmd /k ""%~f0" --run"
  exit /b
)

cd /d "%~dp0"
title GreenSim preview server

echo.
echo ========================================
echo   GreenSim - локальный просмотр
echo ========================================
echo.
echo Папка проекта: %CD%
echo.

where bash >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Git Bash не найден. Установи Git for Windows.
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден или не добавлен в PATH.
  goto :failed
)

if not exist "tools\serve.js" (
  echo ОШИБКА: не найден tools\serve.js
  goto :failed
)

echo [1/3] Собираю index.html...
bash ./build.sh
if errorlevel 1 (
  echo.
  echo ОШИБКА: сборка не прошла.
  goto :failed
)

echo.
echo [2/3] Проверяю порт 8080...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo ОШИБКА: порт 8080 уже занят. Останови другой сервер или закрой программу, которая его использует.
  goto :failed
)

echo.
echo [3/3] Запускаю сервер...
echo Адрес игры: http://localhost:8080/
echo Окно не закрывай. Для остановки нажми Ctrl+C.
echo.
start "" "http://localhost:8080/"
node tools\serve.js
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
echo Сервер завершил работу. Код выхода: %SERVER_EXIT%
goto :end

:failed
echo.
echo Запуск не выполнен. Сообщение об ошибке выше.
:end
echo.
echo Это окно оставлено открытым для диагностики.
pause
