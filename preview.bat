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
  echo ОШИБКА: порт 8080 уже занят. Возможно, сервер GreenSim уже запущен.
  echo Проверь открытые окна терминала и останови старый сервер сочетанием Ctrl+C.
  pause
  exit /b 1
)

echo.
echo [3/3] Запускаю сервер в отдельном окне...
start "GreenSim preview server" "%ComSpec%" /k "cd /d ""%~dp0"" && node tools\serve.js"

echo Жду запуска сервера...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(10); do { Start-Sleep -Milliseconds 250; $ready=Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -InformationLevel Quiet -WarningAction SilentlyContinue } until ($ready -or (Get-Date) -ge $deadline); if (-not $ready) { exit 1 }"
if errorlevel 1 (
  echo Сервер не ответил за 10 секунд. Проверь окно GreenSim preview server.
  pause
  exit /b 1
)

start "" "http://localhost:8080/"
echo.
echo GreenSim открыт в браузере.
echo Сервер продолжает работать в отдельном окне.
echo Чтобы остановить его, перейди в окно GreenSim preview server и нажми Ctrl+C.
echo.
exit /b 0
