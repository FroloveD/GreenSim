#!/usr/bin/env bash
# Локальный сервер для превью: http://localhost:8080/  (корень отдаёт index.html)
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "Теплица: http://localhost:${PORT}/  (Ctrl+C — остановить)"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
