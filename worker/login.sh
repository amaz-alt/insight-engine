#!/usr/bin/env bash
# One-time Facebook login on a headless VPS.
# Starts a virtual screen + noVNC so you can drive the real Chrome window
# from your own browser at http://<vps-ip>:6080 and sign in once.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

cleanup() { kill ${XVFB_PID:-} ${VNC_PID:-} ${WEB_PID:-} 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Stopping the worker so it does not hold the Chrome profile"
systemctl stop fb-worker 2>/dev/null || true

Xvfb :99 -screen 0 1366x900x24 >/dev/null 2>&1 & XVFB_PID=$!
sleep 2
x11vnc -display :99 -forever -nopw -quiet >/dev/null 2>&1 & VNC_PID=$!
websockify --web=/usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 & WEB_PID=$!

echo "==> Open http://$(hostname -I | awk '{print $1}'):6080/vnc.html and log into Facebook"
DISPLAY=:99 HEADLESS=false LOGIN_ONLY=true node src/index.mjs

echo "==> Login stored in ./fb-profile — starting the worker"
systemctl start fb-worker 2>/dev/null || true
