import fs from "node:fs";
import path from "node:path";

import { config } from "./config.mjs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

fs.mkdirSync(config.logDir, { recursive: true });

/** Last 200 structured events, exposed through the /status endpoint. */
export const recentLogs = [];

const REDACT = [config.token].filter(Boolean);
const redact = (text) => REDACT.reduce((acc, secret) => acc.split(secret).join("***"), text);

function emit(level, event, fields = {}) {
  if ((LEVELS[level] ?? 20) < threshold) return;
  const entry = { ts: new Date().toISOString(), level, event, ...fields };
  const line = redact(JSON.stringify(entry));

  recentLogs.push(entry);
  if (recentLogs.length > 200) recentLogs.shift();

  (level === "error" || level === "warn" ? console.error : console.log)(line);
  try {
    const file = path.join(config.logDir, `worker-${entry.ts.slice(0, 10)}.log`);
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* disk full or read-only volume — console output is still intact */
  }
}

export const log = {
  debug: (event, fields) => emit("debug", event, fields),
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
};
