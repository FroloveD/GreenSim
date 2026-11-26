# Все автопроверки одной командой (PowerShell).
#   .\test_all.ps1                всё
#   .\test_all.ps1 --fast         быстрый набор
#   .\test_all.ps1 --no-browser   только Node (как в CI)
Set-Location $PSScriptRoot
bash build.sh
if ($LASTEXITCODE -ne 0) { Write-Host "СБОРКА УПАЛА" -ForegroundColor Red; exit 1 }
node tools/run_all.js @args
exit $LASTEXITCODE
