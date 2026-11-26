#!/usr/bin/env bash
# push_dev.sh — то же, что push_dev.ps1, но для Git Bash / Linux / macOS.
#   ./push_dev.sh /путь/к/GreenSim-update.zip
set -e
ZIP="${1:-./GreenSim-update.zip}"
REPO="https://github.com/FroloveD/GreenSim.git"
BRANCH="dev"
MSG="балкон на юг, локации и даты старта, гарантия 180-364 дня, кнопки без дрожи"

[ -d .git ] || { echo "Это не git-папка: запусти из корня проекта"; exit 1; }
[ -f "$ZIP" ] || { echo "Не нашёл архив: $ZIP"; exit 1; }

echo "== remote origin"
if ! git remote | grep -qx origin; then
  git remote add origin "$REPO"; echo "origin добавлен"
else
  CUR="$(git remote get-url origin)"
  [ "$CUR" = "$REPO" ] || { git remote set-url origin "$REPO"; echo "origin исправлен: было '$CUR'"; }
fi

echo "== забираю $BRANCH с GitHub"
git fetch origin
git checkout -B "$BRANCH" "origin/$BRANCH"

echo "== распаковываю $ZIP"
TMP="$(mktemp -d)"
unzip -q "$ZIP" -d "$TMP"
SRC="$TMP/GreenSim"; [ -d "$SRC" ] || SRC="$TMP"
cp -a "$SRC"/. .
rm -rf "$TMP"

echo "== сборка"
bash build.sh

echo "== коммит и пуш"
git add -A
if [ -z "$(git status --porcelain)" ]; then
  echo "изменений нет — пушить нечего"
else
  git commit -m "$MSG"
  git push origin "$BRANCH"
fi
git log --oneline -3
echo "Готово. Actions: https://github.com/FroloveD/GreenSim/actions"
