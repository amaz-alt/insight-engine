#!/usr/bin/env bash
# Pull the latest worker code and restart in place. The Chrome profile,
# .env and logs are never touched, so you never log into Facebook again.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> Fetching latest code"
git pull --ff-only

if [[ -f docker-compose.yml && -n "$(docker ps -q -f name=fb-worker 2>/dev/null || true)" ]]; then
  echo "==> Rebuilding Docker image and restarting"
  docker compose build
  docker compose up -d
else
  echo "==> Installing dependencies"
  npm install --omit=dev
  npx --yes playwright install chromium
  if systemctl list-unit-files | grep -q fb-worker.service; then
    echo "==> Restarting systemd service"
    systemctl restart fb-worker
  elif command -v pm2 >/dev/null; then
    pm2 restart fb-worker
  fi
fi

sleep 8
echo "==> Health:"
curl -s "http://127.0.0.1:${PORT:-8787}/health" || echo "worker not answering yet — check the logs"
echo
