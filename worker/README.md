# VPS worker setup

The app runs entirely on Lovable Cloud. The only thing you host is this worker,
which drives one real Chrome profile logged into your Facebook account.

## 1. Prepare the VPS

```bash
sudo apt update && sudo apt install -y nodejs npm
mkdir fb-os && cd fb-os
npm init -y && npm i playwright
npx playwright install --with-deps chromium
# copy worker/worker.mjs from this project into fb-os/
```

## 2. Log in once (visible browser, e.g. over VNC / X forwarding)

```bash
APP_URL=https://your-app.lovable.app WORKER_TOKEN=<token from Settings> \
HEADLESS=false node worker.mjs
```

Sign into Facebook in the window that opens. The session is stored in
`./fb-profile` and reused on every later run.

## 3. Run it forever

```bash
APP_URL=https://your-app.lovable.app WORKER_TOKEN=<token> node worker.mjs
```

Or as a service:

```ini
# /etc/systemd/system/fb-os.service
[Service]
WorkingDirectory=/root/fb-os
Environment=APP_URL=https://your-app.lovable.app
Environment=WORKER_TOKEN=<token>
ExecStart=/usr/bin/node worker.mjs
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now fb-os
```

## Endpoints the worker uses

| Endpoint | Purpose |
| --- | --- |
| `POST /api/public/worker/heartbeat` | reports session health |
| `POST /api/public/worker/jobs` | claims due scan / publish jobs + behaviour limits |
| `POST /api/public/worker/ingest` | pushes scraped posts (deduplicated server-side) |
| `POST /api/public/worker/complete` | reports job outcome |

All four authenticate with the `x-worker-token` header (token in **Settings**).
AI analysis, clustering, scheduling and history all stay inside Lovable Cloud.
