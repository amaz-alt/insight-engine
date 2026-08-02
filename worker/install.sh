#!/usr/bin/env bash
# Facebook Growth OS worker — one-shot installer for a fresh Ubuntu VPS.
# Usage:  sudo bash install.sh            (native Node + systemd)
#         sudo bash install.sh --docker   (Docker + docker compose)
set -euo pipefail

MODE="native"
[[ "${1:-}" == "--docker" ]] && MODE="docker"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Shared browser location so root, systemd and PM2 all resolve the same Chromium.
BROWSERS_PATH="/opt/ms-playwright"

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$1"; }
warn() { printf "\n\033[1;33m!!\033[0m %s\n" "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash install.sh"; exit 1
fi

say "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git xvfb x11vnc novnc websockify \
  x11-utils xauth fonts-liberation fonts-noto-color-emoji tzdata jq

if [[ "$MODE" == "docker" ]]; then
  say "Installing Docker"
  if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
else
  say "Installing Node.js 20"
  if ! command -v node >/dev/null || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  say "Installing worker dependencies"
  cd "$DIR"
  npm install --omit=dev

  say "Installing Playwright's bundled Chromium + system libraries into $BROWSERS_PATH"
  mkdir -p "$BROWSERS_PATH"
  # --with-deps pulls every shared library Chromium needs on Ubuntu.
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_PATH" npx --yes playwright install --with-deps chromium
  chmod -R a+rx "$BROWSERS_PATH"

  say "Verifying the Chromium binary"
  CHROME_BIN="$(PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_PATH" node -e \
    "import('playwright').then(p=>console.log(p.chromium.executablePath()))")"
  if [[ -x "$CHROME_BIN" ]]; then
    echo "    Chromium: $CHROME_BIN"
    "$CHROME_BIN" --no-sandbox --headless=new --dump-dom about:blank >/dev/null 2>&1 \
      && echo "    Headless smoke test: OK" \
      || warn "Chromium is installed but failed to start headless — check apt output above."
  else
    warn "Chromium was not found at '$CHROME_BIN'. Re-run: PLAYWRIGHT_BROWSERS_PATH=$BROWSERS_PATH npx playwright install --with-deps chromium"
  fi
fi

mkdir -p "$DIR/logs" "$DIR/fb-profile"
[[ -f "$DIR/.env" ]] || { cp "$DIR/.env.example" "$DIR/.env"; say "Created .env — fill in APP_URL and WORKER_TOKEN"; }

# The worker (and systemd, which reads .env as its EnvironmentFile) must see this.
if ! grep -q '^PLAYWRIGHT_BROWSERS_PATH=' "$DIR/.env"; then
  printf '\n# Shared Playwright browser location (set by install.sh)\nPLAYWRIGHT_BROWSERS_PATH=%s\n' "$BROWSERS_PATH" >> "$DIR/.env"
fi

if [[ "$MODE" == "native" ]]; then
  say "Installing the systemd service"
  sed "s#/opt/fb-worker#$DIR#g" "$DIR/fb-worker.service" > /etc/systemd/system/fb-worker.service
  systemctl daemon-reload
  systemctl enable fb-worker
  cat <<EOF

Install complete.

  1. nano $DIR/.env          # APP_URL + WORKER_TOKEN from the app's Settings page
  2. bash $DIR/login.sh      # one-time Facebook login (open http://<vps-ip>:6080/vnc.html)
  3. systemctl start fb-worker
  4. curl localhost:8787/health

EOF
else
  cat <<EOF

Install complete (Docker mode).

  1. nano $DIR/.env
  2. docker compose --profile login up login   # log into Facebook at http://<vps-ip>:6080/vnc.html
  3. docker compose up -d
  4. curl localhost:8787/health

EOF
fi
