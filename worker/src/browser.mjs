import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { config } from "./config.mjs";
import { log } from "./logger.mjs";
import { pause } from "./human.mjs";

/**
 * One isolated Chrome profile per Facebook account.
 *
 * Every account gets its own persistent profile directory, so several accounts
 * can live on the same VPS without ever sharing cookies, and a crash in one
 * never takes the others down. "default" maps to the original PROFILE_DIR so an
 * existing single-account install keeps its login after upgrading.
 */
const sessions = new Map(); // profile -> { context, page }

export const state = {
  startedAt: new Date().toISOString(),
  chromeStatus: "starting",
  sessionStatus: "unknown",
  sessionValidatedAt: null,
  lastHeartbeatAt: null,
  lastScanAt: null,
  lastPublishAt: null,
  currentJob: null,
  jobsDone: 0,
  jobsFailed: 0,
  chromeRestarts: 0,
  lastError: null,
  /** Per-account health, keyed by profile directory name. */
  accounts: {},
};

export const DEFAULT_PROFILE = "default";

export function accountState(profile) {
  state.accounts[profile] ??= {
    profile_dir: profile,
    chrome_status: "stopped",
    session_status: "unknown",
    session_validated_at: null,
    session_expires_at: null,
    last_scan_at: null,
    last_publish_at: null,
    last_error: null,
  };
  return state.accounts[profile];
}

export function profilePath(profile) {
  return profile === DEFAULT_PROFILE
    ? config.profileDir
    : path.join(config.profilesRoot, profile);
}

/** Launch (or relaunch) Chrome on one account's persistent profile. */
export async function getPage(profile = DEFAULT_PROFILE) {
  const existing = sessions.get(profile);
  if (existing?.page && !existing.page.isClosed()) return existing.page;

  const account = accountState(profile);
  const dir = profilePath(profile);
  fs.mkdirSync(dir, { recursive: true });
  // Clear stale singleton locks left behind by a VPS reboot or a hard kill.
  for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(path.join(dir, lock), { force: true });
    } catch {
      /* ignore */
    }
  }

  // Playwright's bundled Chromium lives under PLAYWRIGHT_BROWSERS_PATH; install.sh
  // puts it in a shared location so root and systemd resolve the same binary.
  let executablePath;
  try {
    executablePath = chromium.executablePath();
  } catch {
    executablePath = undefined;
  }
  if (executablePath && !fs.existsSync(executablePath)) {
    log.error("chrome.missing", {
      executablePath,
      browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "(default)",
      hint: "run: PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx playwright install --with-deps chromium",
    });
    state.chromeStatus = "missing";
    account.chrome_status = "missing";
    throw new Error(`Chromium is not installed at ${executablePath}. Re-run install.sh.`);
  }

  const args = [
    "--disable-blink-features=AutomationControlled",
    // Chrome refuses to start as root without this; the VPS runs the worker as root.
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
  ];

  let context;
  try {
    context = await chromium.launchPersistentContext(dir, {
      headless: config.headless,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
      timezoneId: process.env.TZ || undefined,
      ignoreDefaultArgs: ["--enable-automation"],
      args,
    });
  } catch (error) {
    state.chromeStatus = "failed";
    account.chrome_status = "failed";
    account.last_error = String(error?.message ?? error);
    log.error("chrome.launch_failed", {
      profile,
      error: String(error?.message ?? error),
      headless: config.headless,
      display: process.env.DISPLAY ?? "(none)",
      hint: config.headless
        ? "check that Chromium and its system libraries are installed (bash install.sh)"
        : "an X display is required for headful mode — start it with login.sh",
    });
    throw error;
  }

  context.on("close", () => {
    sessions.delete(profile);
    account.chrome_status = "crashed";
    state.chromeStatus = "crashed";
    log.warn("chrome.closed", { profile });
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(45_000);
  sessions.set(profile, { context, page });
  state.chromeStatus = "running";
  account.chrome_status = "running";
  log.info("chrome.started", {
    profile,
    headless: config.headless,
    dir,
    executablePath: executablePath ?? "(playwright default)",
  });
  return page;
}

export async function closeBrowser(profile) {
  const targets = profile ? [profile] : [...sessions.keys()];
  for (const key of targets) {
    try {
      await sessions.get(key)?.context?.close();
    } catch {
      /* ignore */
    }
    sessions.delete(key);
    accountState(key).chrome_status = "stopped";
  }
  if (!sessions.size) state.chromeStatus = "stopped";
}

/** Kill and relaunch one account's Chrome — after a crash or a restart command. */
export async function restartBrowser(reason, profile = DEFAULT_PROFILE) {
  state.chromeRestarts += 1;
  log.warn("chrome.restart", { reason, profile });
  await closeBrowser(profile);
  await pause(2000, 5000);
  return getPage(profile);
}

/**
 * Cookie-only session probe. Never navigates, so it is safe to poll while the
 * user is typing into the Facebook login form during the one-time login.
 */
export async function probeSession(p, profile = DEFAULT_PROFILE) {
  const account = accountState(profile);
  let cookies = [];
  try {
    cookies = await p.context().cookies("https://www.facebook.com");
  } catch {
    return { loggedIn: false, expiresAt: null };
  }
  const cUser = cookies.find((c) => c.name === "c_user");
  const xs = cookies.find((c) => c.name === "xs");
  const loggedIn = Boolean(cUser?.value && xs?.value);

  state.sessionStatus = loggedIn ? "connected" : "needs_login";
  account.session_status = loggedIn ? "connected" : "needs_login";
  if (loggedIn) {
    state.sessionValidatedAt = new Date().toISOString();
    account.session_validated_at = state.sessionValidatedAt;
  }

  const expiry = [xs, cUser].find((c) => c?.expires > 0);
  const expiresAt = expiry ? new Date(expiry.expires * 1000).toISOString() : null;
  if (expiresAt) account.session_expires_at = expiresAt;
  return { loggedIn, expiresAt };
}

/** True when this account's profile still holds a valid Facebook session. */
export async function checkSession(p, profile = DEFAULT_PROFILE) {
  const account = accountState(profile);
  await p.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
  await pause(2000, 4000);
  const loggedOut =
    (await p.locator('input[name="pass"]').count()) > 0 ||
    /login|checkpoint/.test(new URL(p.url()).pathname);

  state.sessionStatus = loggedOut ? "needs_login" : "connected";
  account.session_status = loggedOut ? "needs_login" : "connected";
  if (!loggedOut) {
    state.sessionValidatedAt = new Date().toISOString();
    account.session_validated_at = state.sessionValidatedAt;
  }

  // Facebook's long-lived cookie expiry is the best available hint.
  let expiresAt = null;
  try {
    const cookies = await p.context().cookies("https://www.facebook.com");
    const cUser = cookies.find((c) => c.name === "c_user" || c.name === "xs");
    if (cUser?.expires > 0) expiresAt = new Date(cUser.expires * 1000).toISOString();
  } catch {
    /* ignore */
  }
  if (expiresAt) account.session_expires_at = expiresAt;
  return { loggedIn: !loggedOut, expiresAt };
}
