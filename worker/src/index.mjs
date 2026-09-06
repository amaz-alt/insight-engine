/**
 * Facebook Growth OS — production VPS worker.
 *
 * The only external component: keeps one logged-in Chrome profile *per Facebook
 * account*, heartbeats to Lovable every minute, polls for jobs, scrapes groups,
 * publishes approved posts, retries with exponential backoff and recovers from
 * reboots, Chrome crashes and Facebook session expiry on its own.
 */
import { assertConfig, config } from "./config.mjs";
import { log } from "./logger.mjs";
import { api } from "./api.mjs";
import { backoffMs, pause, shuffle, sleep } from "./human.mjs";
import {
  DEFAULT_PROFILE,
  accountState,
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

const runtime = {
  paused: false,
  queue: [],
  stopping: false,
  /** Accounts as reported by the app on the last heartbeat. */
  accounts: [{ profile_dir: DEFAULT_PROFILE, name: "Primary account", enabled: true }],
};
const attempts = new Map(); // job id -> local attempt count

startServer(runtime);

const profileOf = (job) => job?.payload?.profile_dir || DEFAULT_PROFILE;

/**
 * Check every account the app knows about, then report all of them in one call.
 * A failure on one account never stops the others from being reported.
 */
async function heartbeat() {
  const reports = [];

  for (const account of runtime.accounts) {
    if (account.enabled === false) continue;
    const profile = account.profile_dir || DEFAULT_PROFILE;
    const local = accountState(profile);
    try {
      const page = await getPage(profile);
      const { loggedIn, expiresAt } = await checkSession(page, profile);
      if (!loggedIn) {
        log.warn("session.needs_login", {
          profile,
          account: account.name,
          hint: `run: LOGIN_PROFILE=${profile} bash login.sh — then sign in once in the browser window`,
        });
      }
      reports.push({
        profile_dir: profile,
        session_status: loggedIn ? "connected" : "needs_login",
        chrome_status: local.chrome_status,
        session_expires_at: expiresAt ?? local.session_expires_at ?? undefined,
        last_scan_at: local.last_scan_at ?? undefined,
        last_publish_at: local.last_publish_at ?? undefined,
      });
    } catch (error) {
      local.last_error = String(error?.message ?? error);
      log.error("heartbeat.account_failed", { profile, error: local.last_error });
      reports.push({
        profile_dir: profile,
        session_status: "disconnected",
        chrome_status: local.chrome_status,
      });
      if (local.chrome_status !== "running") {
        await restartBrowser("heartbeat failure", profile).catch(() => {});
      }
    }
  }

  try {
    const res = await api("heartbeat", {
      accounts: reports,
      worker_version: config.version,
      // Back-compat summary fields for the single-account view.
      session_status: reports.find((r) => r.session_status === "connected")
        ? "connected"
        : (reports[0]?.session_status ?? "disconnected"),
      chrome_status: state.chromeStatus,
      current_job_id: state.currentJob?.id ?? undefined,
    });

    state.lastHeartbeatAt = new Date().toISOString();
    runtime.paused = Boolean(res.paused);
    if (Array.isArray(res.accounts) && res.accounts.length) runtime.accounts = res.accounts;

    if (res.command) await handleCommand(res.command, DEFAULT_PROFILE);
    for (const account of runtime.accounts) {
      if (account.pending_command) {
        await handleCommand(account.pending_command, account.profile_dir || DEFAULT_PROFILE);
      }
    }
  } catch (error) {
    state.lastError = error.message;
    log.error("heartbeat.failed", { error: error.message });
  }
}

async function handleCommand(command, profile = DEFAULT_PROFILE) {
  log.info("command.received", { command, profile });
  if (command === "restart_worker") {
    await closeBrowser();
    process.exit(0); // supervisor (Docker/systemd/PM2) brings it straight back
  }
  if (command === "restart_chrome" || command === "reconnect") {
    await restartBrowser(command, profile);
  }
  if (command === "validate_session") {
    const page = await getPage(profile);
    await checkSession(page, profile);
  }
}

async function runJob(job) {
  const profile = profileOf(job);
  const local = accountState(profile);
  const attempt = (attempts.get(job.id) ?? 0) + 1;
  attempts.set(job.id, attempt);
  state.currentJob = {
    id: job.id,
    type: job.type,
    profile,
    started_at: new Date().toISOString(),
  };

  try {
    const page = await getPage(profile);
    const result =
      job.type === "scan_group" ? await scanGroup(page, job) : await publishPost(page, job);
    if (job.type === "scan_group") local.last_scan_at = new Date().toISOString();
    else local.last_publish_at = new Date().toISOString();
    await api("complete", { job_id: job.id, status: "done", result_url: result.result_url });
    state.jobsDone += 1;
    attempts.delete(job.id);
  } catch (error) {
    const message = String(error?.message ?? error);
    state.jobsFailed += 1;
    state.lastError = message;
    local.last_error = message;
    log.error("job.failed", { job: job.id, type: job.type, profile, attempt, error: message });

    // Session gone or Chrome dead → requeue so nothing is lost, then recover.
    const recoverable = /login|checkpoint|closed|crash|Target|Timeout|net::/i.test(message);
    await api("complete", {
      job_id: job.id,
      status: recoverable && attempt < (job.max_attempts ?? 3) ? "queued" : "failed",
      error: message.slice(0, 500),
    }).catch(() => {});

    if (recoverable) {
      await restartBrowser(`job error: ${message.slice(0, 80)}`, profile).catch(() => {});
    }
    await sleep(backoffMs(attempt));
  } finally {
    state.currentJob = null;
  }
}

async function poll() {
  if (runtime.paused) return log.debug("poll.paused", {});

  const { jobs = [], behaviour = {}, accounts } = await api("jobs", {});
  if (Array.isArray(accounts) && accounts.length) runtime.accounts = accounts;
  runtime.queue = jobs;
  if (!jobs.length) return log.debug("poll.empty", {});
  log.info("poll.batch", { jobs: jobs.length });

  for (const job of shuffle(jobs)) {
    if (runtime.stopping || runtime.paused) break;

    const profile = profileOf(job);
    // Never touch Facebook with an account that is not signed in.
    const { loggedIn } = await probeSession(await getPage(profile), profile);
    if (!loggedIn) {
      log.warn("job.skipped", { job: job.id, profile, reason: "account needs login" });
      await api("complete", {
        job_id: job.id,
        status: "queued",
        error: "that account is signed out — run the one-time login again",
      }).catch(() => {});
      continue;
    }

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

    await runJob(job);
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

if (config.loginOnly) {
  // One-time interactive login for ONE account. Navigate ONCE, then poll cookies
  // only — a repeated goto() would wipe whatever the user is typing.
  const profile = config.loginProfile;
  log.info("login.profile", { profile });
  const loginPage = await getPage(profile);
  try {
    await loginPage.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
  } catch (error) {
    log.warn("login.navigation_failed", { error: String(error?.message ?? error) });
  }

  log.info("login.waiting", {
    profile,
    hint: "sign into Facebook in the window shown at http://<vps-ip>:6080/vnc.html",
    timeout_minutes: 45,
  });

  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    const current = await getPage(profile).catch(() => null);
    if (!current || current.isClosed()) {
      // The user (or a crash) closed the window — bring it back so the session
      // stays reachable instead of the process dying.
      log.warn("login.window_gone", { action: "relaunching", profile });
      await restartBrowser("login window closed", profile).catch(() => {});
    }
    const { loggedIn } = await probeSession(await getPage(profile), profile);
    if (loggedIn) {
      log.info("login.success", { profile });
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
