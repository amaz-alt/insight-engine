#!/usr/bin/env bash
# One-time Facebook login on a headless VPS.
# Starts a virtual X screen + x11vnc + noVNC so you can drive the real Chromium
# window from your own browser at http://<vps-ip>:6080/vnc.html and sign in once.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

DISPLAY_NUM="${DISPLAY_NUM:-99}"
VNC_PORT="${VNC_PORT:-5900}"
WEB_PORT="${WEB_PORT:-6080}"
export DISPLAY=":$DISPLAY_NUM"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$1"; }
die() { printf "\n\033[1;31mxx\033[0m %s\n" "$1"; exit 1; }

for bin in Xvfb x11vnc websockify xdpyinfo; do
  command -v "$bin" >/dev/null || die "$bin is missing — run: sudo bash install.sh"
done

CHROME_BIN="$(node -e "import('playwright').then(p=>console.log(p.chromium.executablePath())).catch(()=>process.exit(1))" 2>/dev/null || true)"
if [[ -z "${CHROME_BIN:-}" || ! -x "$CHROME_BIN" ]]; then
  die "Playwright's Chromium is not installed (looked in $PLAYWRIGHT_BROWSERS_PATH).
   Fix with: sudo PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH npx playwright install --with-deps chromium"
fi
say "Using Chromium: $CHROME_BIN"

WATCHDOG_PID=""
cleanup() {
  say "Shutting the VNC session down"
  kill "${WATCHDOG_PID:-}" 2>/dev/null || true
  pkill -f "websockify --web=/usr/share/novnc $WEB_PORT" 2>/dev/null || true
  pkill -f "x11vnc -display :$DISPLAY_NUM" 2>/dev/null || true
  pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say "Stopping the worker so it does not hold the Chrome profile"
systemctl stop fb-worker 2>/dev/null || true
docker compose stop worker 2>/dev/null || true

# Clear anything left over from an earlier attempt (the usual cause of a
# noVNC page that reconnects in a loop).
cleanup_stale() {
  pkill -f "x11vnc -display :$DISPLAY_NUM" 2>/dev/null || true
  pkill -f "websockify --web=/usr/share/novnc $WEB_PORT" 2>/dev/null || true
  pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true
  sleep 1
}
cleanup_stale

say "Starting the virtual screen on $DISPLAY"
Xvfb ":$DISPLAY_NUM" -screen 0 1366x900x24 -nolisten tcp -ac >>logs/xvfb.log 2>&1 &
for _ in $(seq 1 30); do xdpyinfo -display ":$DISPLAY_NUM" >/dev/null 2>&1 && break; sleep 1; done
xdpyinfo -display ":$DISPLAY_NUM" >/dev/null 2>&1 || die "Xvfb did not start — see logs/xvfb.log"

say "Starting the VNC server and noVNC bridge"
start_vnc() {
  x11vnc -display ":$DISPLAY_NUM" -rfbport "$VNC_PORT" -forever -shared -nopw -noxdamage \
    -repeat -xkb -bg -o logs/x11vnc.log >/dev/null 2>&1
}
start_vnc
for _ in $(seq 1 30); do (echo >/dev/tcp/127.0.0.1/$VNC_PORT) 2>/dev/null && break; sleep 1; done
(echo >/dev/tcp/127.0.0.1/$VNC_PORT) 2>/dev/null || die "x11vnc did not start — see logs/x11vnc.log"

websockify --web=/usr/share/novnc "$WEB_PORT" "localhost:$VNC_PORT" >>logs/novnc.log 2>&1 &
for _ in $(seq 1 30); do (echo >/dev/tcp/127.0.0.1/$WEB_PORT) 2>/dev/null && break; sleep 1; done
(echo >/dev/tcp/127.0.0.1/$WEB_PORT) 2>/dev/null || die "noVNC did not start — see logs/novnc.log"

# Keep the VNC session alive for the whole login, even if x11vnc drops a client.
(
  while true; do
    sleep 5
    (echo >/dev/tcp/127.0.0.1/$VNC_PORT) 2>/dev/null || start_vnc
    (echo >/dev/tcp/127.0.0.1/$WEB_PORT) 2>/dev/null || \
      websockify --web=/usr/share/novnc "$WEB_PORT" "localhost:$VNC_PORT" >>logs/novnc.log 2>&1 &
  done
) & WATCHDOG_PID=$!

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

  Open  http://${IP:-<vps-ip>}:$WEB_PORT/vnc.html   (click Connect, no password)
  Sign into Facebook in the Chromium window you see there.
  The session is detected automatically — this script then stores it in ./fb-profile.
  Press Ctrl-C at any time to stop.

EOF

say "Launching Chromium for the interactive login"
HEADLESS=false LOGIN_ONLY=true node src/index.mjs
STATUS=$?

if [[ $STATUS -eq 0 ]]; then
  say "Login stored in ./fb-profile — starting the worker"
  systemctl start fb-worker 2>/dev/null || docker compose up -d worker 2>/dev/null || true
else
  say "Login did not complete (exit $STATUS). Check logs/worker-*.log and re-run: bash login.sh"
fi
exit $STATUS
