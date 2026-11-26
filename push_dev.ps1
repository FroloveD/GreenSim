# push_dev.ps1 — выкладывает архив в ветку dev репозитория FroloveD/GreenSim
#
# Зачем: пуш из моей песочницы невозможен (нет доступа к твоему GitHub),
# поэтому всё, что нужно сделать руками, собрано в один запуск.
#
# Как запускать (PowerShell, из папки с игрой):
#   .\push_dev.ps1 -Zip "C:\Users\ты\Downloads\GreenSim-update.zip"
# Если файл архива лежит рядом с игрой и называется GreenSim-update.zip:
#   .\push_dev.ps1
#
# Что делает:
#   1) чинит remote origin, если он испорчен (частая ошибка: в адрес попала ссылка из чата)
#   2) забирает ветку dev с GitHub как есть (включая твои правки workflow из веба)
#   3) распаковывает архив поверх папки
#   4) коммитит и пушит в dev
#
# Что НЕ делает: ничего не удаляет из папки и не трогает другие ветки.
# Перед запуском, если в папке есть несохранённые правки, сделай копию папки.

param(
  [string]$Zip = ".\GreenSim-update.zip",
  [string]$Repo = "https://github.com/FroloveD/GreenSim.git",
  [string]$Branch = "dev",
  [string]$Message = "балкон на юг, локации и даты старта, гарантия 180-364 дня, кнопки без дрожи"
)

$ErrorActionPreference = "Stop"

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }

# 0. мы вообще в репозитории? git работает с ТЕКУЩЕЙ папкой, а не с той,
#    что написана в команде, — поэтому сначала печатаем, откуда пойдёт пуш
Step "проверяю папку"
Write-Host "текущая папка:   $(Get-Location)"
if (-not (Test-Path ".git")) {
  throw "Здесь нет папки .git — это не корень репозитория. Перейди в папку проекта (cd D:\Dev\GreenSimDev) и запусти снова."
}
Write-Host "корень репозитория: $(git rev-parse --show-toplevel)"
Write-Host "origin:             $(git remote get-url origin 2>$null)"
if (-not (Test-Path $Zip)) { throw "Не нашёл архив: $Zip. Укажи путь через -Zip." }

# 1. remote origin
Step "remote origin"
$existing = (git remote) 2>$null
if ($existing -notcontains "origin") {
  git remote add origin $Repo
  Write-Host "origin добавлен: $Repo"
} else {
  $current = (git remote get-url origin).Trim()
  if ($current -ne $Repo) {
    git remote set-url origin $Repo
    Write-Host "origin исправлен: было '$current', стало '$Repo'"
  } else {
    Write-Host "origin в порядке: $Repo"
  }
}

# 2. свежая dev с GitHub
Step "забираю $Branch с GitHub"
git fetch origin
git checkout -B $Branch "origin/$Branch"

# 3. распаковка архива поверх
Step "распаковываю $Zip"
$tmp = Join-Path $env:TEMP ("gs_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
Expand-Archive -Path $Zip -DestinationPath $tmp -Force
# архив упакован с папкой GreenSim/ — берём её содержимое
$src = Join-Path $tmp "GreenSim"
if (-not (Test-Path $src)) { $src = $tmp }
Copy-Item -Path (Join-Path $src "*") -Destination (Get-Location) -Recurse -Force
Remove-Item -Path $tmp -Recurse -Force
Write-Host "файлы обновлены"

# 4. сборка и проверка (чтобы не запушить рассинхрон index.html / parts)
Step "собираю index.html из parts/*"
bash build.sh

# 5. коммит и пуш
Step "коммит и пуш в $Branch"
git add -A
$changes = (git status --porcelain).Length
if ($changes -eq 0) {
  Write-Host "изменений нет — пушить нечего (архив совпал с веткой)" -ForegroundColor Yellow
} else {
  git commit -m $Message
  git push origin $Branch
}

Step "готово"
git log --oneline -3
Write-Host ""
Write-Host "Дальше GitHub сам запустит проверки и Pages: https://github.com/FroloveD/GreenSim/actions" -ForegroundColor Green
Write-Host "Сайт: https://froloved.github.io/GreenSim/"
