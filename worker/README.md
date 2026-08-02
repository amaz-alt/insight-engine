# Facebook Growth OS — VPS worker

The app runs entirely on Lovable Cloud. This worker is the only thing you host:
one real Chrome profile, permanently logged into your Facebook account.

- Playwright + persistent Chrome profile (`./fb-profile`) — log in once, ever.
- Heartbeat every 60s, job polling every 60s.
- Human-like behaviour: randomized delays, uneven scrolling, mouse drift,
  natural typing cadence, shuffled job order.
- Automatic retry with exponential backoff; recoverable jobs are requeued in the app.
- Self-recovery after VPS reboot, Chrome crash and Facebook session expiry.
- Structured JSON logs (stdout + `./logs/worker-YYYY-MM-DD.log`), token-redacted.
- Local endpoints: `/health`, `/version`, `/status` (token-protected).

## Deploy on a fresh Ubuntu VPS

```bash
ssh root@your-vps
git clone <your-worker-repo> /opt/fb-worker
cd /opt/fb-worker/worker            # or wherever this folder lives
sudo bash install.sh                # Node 20 + Chromium + systemd service
nano .env                           # APP_URL + WORKER_TOKEN (Settings page in the app)
sudo bash login.sh                  # opens noVNC — sign into Facebook once
sudo systemctl start fb-worker
curl localhost:8787/health
```

`login.sh` prints a URL like `http://<vps-ip>:6080/vnc.html`. Open it in your own
browser, sign into Facebook in the Chrome window you see, and the script stores
the session in `./fb-profile` and starts the worker. You never log in again
unless Facebook invalidates the session — the app's **Worker Health** page shows
`needs_login` if that ever happens.

### Docker instead

```bash
sudo bash install.sh --docker
nano .env
docker compose --profile login up login   # log in at http://<vps-ip>:6080
docker compose up -d
docker compose logs -f worker
```

### PM2 instead of systemd (optional)

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

## Day-to-day

```bash
systemctl status fb-worker           # is it alive
journalctl -u fb-worker -f           # live logs
curl -s localhost:8787/health        # ok / degraded
curl -s localhost:8787/version
curl -s -H "x-worker-token: $WORKER_TOKEN" localhost:8787/status | jq
bash update.sh                       # pull new code + restart, keeps the login
```

`/status` is loopback-bound by default. To read it from your laptop:
`ssh -L 8787:127.0.0.1:8787 root@your-vps`.

## Endpoints

Worker → app (all authenticated with `x-worker-token`):

| Endpoint | Purpose |
| --- | --- |
| `POST /api/public/worker/heartbeat` | session + Chrome health, receives commands and the pause flag |
| `POST /api/public/worker/jobs` | claims due scan/publish jobs plus safety limits |
| `POST /api/public/worker/ingest` | pushes scraped discussions (deduplicated server-side) |
| `POST /api/public/worker/complete` | reports `done` / `failed` / `queued` (retry) |

Commands the app can send from Worker Health: `validate_session`, `reconnect`
(restarts Chrome), `restart_worker` (process exits; the supervisor restarts it).

## Environment

See `.env.example`. Credentials are never stored by the worker — only the Chrome
profile holds the Facebook session, and the shared `WORKER_TOKEN` is redacted
from every log line.
