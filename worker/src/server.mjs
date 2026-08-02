import http from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";

import { config } from "./config.mjs";
import { log, recentLogs } from "./logger.mjs";
import { state } from "./browser.mjs";

const digest = (value) => createHash("sha256").update(String(value)).digest();
const tokenOk = (request) => {
  const presented =
    request.headers["x-worker-token"] ??
    (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return timingSafeEqual(digest(presented), digest(config.token));
};

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

/**
 * Local HTTP surface for monitoring. /health and /version are unauthenticated
 * (no sensitive data, so uptime checks work); /status requires the shared token.
 */
export function startServer(runtime) {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";

    if (path === "/health") {
      const stale =
        !state.lastHeartbeatAt ||
        Date.now() - Date.parse(state.lastHeartbeatAt) > config.heartbeatSeconds * 4000;
      const healthy = state.chromeStatus === "running" && !stale;
      return send(res, healthy ? 200 : 503, {
        status: healthy ? "ok" : "degraded",
        chrome: state.chromeStatus,
        session: state.sessionStatus,
        last_heartbeat_at: state.lastHeartbeatAt,
      });
    }

    if (path === "/version") {
      return send(res, 200, {
        version: config.version,
        node: process.version,
        started_at: state.startedAt,
      });
    }

    if (path === "/status") {
      if (!tokenOk(req)) return send(res, 401, { error: "unauthorized" });
      return send(res, 200, {
        version: config.version,
        uptime_seconds: Math.round(process.uptime()),
        app_url: config.appUrl,
        headless: config.headless,
        ...state,
        paused: runtime.paused,
        queue: runtime.queue.map((j) => ({ id: j.id, type: j.type })),
        recent_logs: recentLogs.slice(-50),
      });
    }

    return send(res, 404, { error: "not_found" });
  });

  server.listen(config.port, config.bind, () =>
    log.info("server.listening", { bind: config.bind, port: config.port }),
  );
  return server;
}
