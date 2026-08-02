import fs from "node:fs";
import path from "node:path";

// Tiny .env loader so the worker runs identically under Docker, systemd and PM2.
const envFile = path.resolve(process.cwd(), process.env.ENV_FILE ?? ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const num = (name, fallback) => Number(process.env[name] ?? fallback) || fallback;

export const VERSION = "1.0.0";

export const config = {
  version: VERSION,
  appUrl: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
  token: process.env.WORKER_TOKEN ?? "",
  port: num("PORT", 8787),
  bind: process.env.BIND ?? "127.0.0.1",
  profileDir: process.env.PROFILE_DIR ?? "./fb-profile",
  headless: process.env.HEADLESS !== "false",
  loginOnly: process.env.LOGIN_ONLY === "true",
  heartbeatSeconds: num("HEARTBEAT_SECONDS", 60),
  pollSeconds: num("POLL_SECONDS", 60),
  logDir: process.env.LOG_DIR ?? "./logs",
  logLevel: process.env.LOG_LEVEL ?? "info",
};

export function assertConfig() {
  const missing = ["appUrl", "token"].filter((k) => !config[k]);
  if (missing.length) {
    console.error(
      `Missing required env: ${missing.map((m) => (m === "appUrl" ? "APP_URL" : "WORKER_TOKEN")).join(", ")}. Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
}
