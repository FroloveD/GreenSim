@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   GreenSim - сборка и локальный просмотр
echo ========================================
echo.

where bash >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Git Bash не найден. Установи Git for Windows.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ОШИБКА: Node.js не найден или не добавлен в PATH.
  pause
  exit /b 1
)

echo [1/3] Собираю index.html из файлов parts...
bash ./build.sh
if errorlevel 1 (
  echo.
  echo СБОРКА НЕ ПРОШЛА. Сервер не запущен.
  pause
  exit /b 1
)

echo.
echo [2/3] Проверяю порт 8080...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo ОШИБКА: порт 8080 уже занят.
  echo Останови предыдущий сервер GreenSim сочетанием Ctrl+C в его окне.
  pause
  exit /b 1
)

echo.
echo [3/3] Запускаю сервер в этом окне...
echo Адрес игры: http://localhost:8080/
echo Для остановки сервера нажми Ctrl+C.
echo.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080/'"
node tools\serve.js

if errorlevel 1 (
  echo.
  echo ОШИБКА: сервер завершился с ошибкой.
  pause
)
