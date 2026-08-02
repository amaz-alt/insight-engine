/**
 * Facebook Growth OS — production VPS worker.
 *
 * The only external component: keeps one logged-in Chrome profile, heartbeats
 * to Lovable every minute, polls for jobs, scrapes groups, publishes approved
 * posts, retries with exponential backoff and recovers from reboots, Chrome
 * crashes and Facebook session expiry on its own.
 */
import { assertConfig, config } from "./config.mjs";
import { log } from "./logger.mjs";
import { api } from "./api.mjs";
import { backoffMs, pause, shuffle, sleep } from "./human.mjs";
import {
  checkSession,
  closeBrowser,
  getPage,
  probeSession,
  restartBrowser,
  state,
} from "./browser.mjs";

import { publishPost, scanGroup } from "./jobs.mjs";
import { startServer } from "./server.mjs";

assertConfig();

const runtime = { paused: false, queue: [], stopping: false, sessionExpiresAt: null };
const attempts = new Map(); // job id -> local attempt count

startServer(runtime);

async function heartbeat() {
  try {
    const page = await getPage();
    const { loggedIn, expiresAt } = await checkSession(page);
    if (expiresAt) runtime.sessionExpiresAt = expiresAt;

    const res = await api("heartbeat", {
      session_status: loggedIn ? "connected" : "needs_login",
      worker_version: config.version,
      chrome_status: state.chromeStatus,
      session_expires_at: runtime.sessionExpiresAt ?? undefined,
      current_job_id: state.currentJob?.id ?? undefined,
    });

    state.lastHeartbeatAt = new Date().toISOString();
    runtime.paused = Boolean(res.paused);

    if (res.command) await handleCommand(res.command);
    if (!loggedIn) {
      log.warn("session.needs_login", {
        hint: "run `npm run login` (or docker compose run --rm login) and sign in once",
      });
    }
  } catch (error) {
    state.lastError = error.message;
    log.error("heartbeat.failed", { error: error.message });
    if (state.chromeStatus !== "running") await restartBrowser("heartbeat failure").catch(() => {});
  }
}

async function handleCommand(command) {
  log.info("command.received", { command });
  if (command === "restart_worker") {
    await closeBrowser();
    process.exit(0); // supervisor (Docker/systemd/PM2) brings it straight back
  }
  if (command === "restart_chrome" || command === "reconnect") {
    await restartBrowser(command);
  }
  if (command === "validate_session") {
    const page = await getPage();
    await checkSession(page);
  }
}

async function runJob(page, job) {
  const attempt = (attempts.get(job.id) ?? 0) + 1;
  attempts.set(job.id, attempt);
  state.currentJob = { id: job.id, type: job.type, started_at: new Date().toISOString() };

  try {
    const result =
      job.type === "scan_group" ? await scanGroup(page, job) : await publishPost(page, job);
    await api("complete", { job_id: job.id, status: "done", result_url: result.result_url });
    state.jobsDone += 1;
    attempts.delete(job.id);
  } catch (error) {
    const message = String(error?.message ?? error);
    state.jobsFailed += 1;
    state.lastError = message;
    log.error("job.failed", { job: job.id, type: job.type, attempt, error: message });

    // Session gone or Chrome dead → requeue so nothing is lost, then recover.
    const recoverable = /login|checkpoint|closed|crash|Target|Timeout|net::/i.test(message);
    await api("complete", {
      job_id: job.id,
      status: recoverable && attempt < 3 ? "queued" : "failed",
      error: message.slice(0, 500),
    }).catch(() => {});

    if (recoverable) await restartBrowser(`job error: ${message.slice(0, 80)}`).catch(() => {});
    await sleep(backoffMs(attempt));
  } finally {
    state.currentJob = null;
  }
}

async function poll() {
  if (runtime.paused) return log.debug("poll.paused", {});
  const page = await getPage();
  if (state.sessionStatus !== "connected") return log.warn("poll.skipped", { reason: "no session" });

  const { jobs = [], behaviour = {} } = await api("jobs", {});
  runtime.queue = jobs;
  if (!jobs.length) return log.debug("poll.empty", {});
  log.info("poll.batch", { jobs: jobs.length });

  for (const job of shuffle(jobs)) {
    if (runtime.stopping || runtime.paused) break;
    await sleep((job.delay_before_seconds ?? 30) * 1000);

    const hour = new Date().getHours();
    const outsideWindow =
      job.type === "publish_post" &&
      behaviour.window_start_hour !== undefined &&
      (hour < behaviour.window_start_hour || hour >= behaviour.window_end_hour);
    if (outsideWindow || (job.type === "publish_post" && behaviour.in_quiet_hours)) {
      await api("complete", {
        job_id: job.id,
        status: "queued",
        error: "outside the posting window",
      }).catch(() => {});
      continue;
    }

    await runJob(page, job);
    runtime.queue = runtime.queue.filter((j) => j.id !== job.id);
    await pause(4000, 12_000);
  }
}

async function loop(name, fn, seconds) {
  while (!runtime.stopping) {
    try {
      await fn();
    } catch (error) {
      log.error(`${name}.loop_error`, { error: String(error?.message ?? error) });
    }
    await sleep(seconds * 1000 * (0.85 + Math.random() * 0.3));
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log.info("shutdown", { signal });
    runtime.stopping = true;
    await closeBrowser();
    process.exit(0);
  });
}
process.on("unhandledRejection", (error) =>
  log.error("unhandled_rejection", { error: String(error?.message ?? error) }),
);

log.info("worker.start", { version: config.version, app_url: config.appUrl });
await getPage();

if (config.loginOnly) {
  // One-time interactive login. Navigate ONCE, then poll cookies only — a repeated
  // goto() would wipe whatever the user is typing into the login form.
  const loginPage = await getPage();
  try {
    await loginPage.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
  } catch (error) {
    log.warn("login.navigation_failed", { error: String(error?.message ?? error) });
  }

  log.info("login.waiting", {
    hint: "sign into Facebook in the window shown at http://<vps-ip>:6080/vnc.html",
    timeout_minutes: 45,
  });

  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    if (!loginPage || loginPage.isClosed() || state.chromeStatus !== "running") {
      // The user (or a crash) closed the window — bring it back so the session
      // stays reachable instead of the process dying.
      log.warn("login.window_gone", { action: "relaunching" });
      await restartBrowser("login window closed").catch(() => {});
    }
    const { loggedIn } = await probeSession(await getPage());
    if (loggedIn) {
      log.info("login.success", { profile: config.profileDir });
      await sleep(3000); // let Facebook flush the session cookies to disk
      await closeBrowser();
      process.exit(0);
    }
    await sleep(5000);
  }
  log.error("login.timeout", { hint: "re-run login.sh and sign in within 45 minutes" });
  await closeBrowser();
  process.exit(1);
}


await heartbeat();
loop("heartbeat", heartbeat, config.heartbeatSeconds);
loop("poll", poll, config.pollSeconds);
