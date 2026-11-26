#!/usr/bin/env bash
# Все автопроверки одной командой.
#   ./test_all.sh            всё (нужен браузер: npm i playwright-core @sparticuz/chromium)
#   ./test_all.sh --fast     быстрый набор
#   ./test_all.sh --no-browser   только Node (как в CI)
set -e
cd "$(dirname "$0")"
./build.sh
node tools/run_all.js "$@"
