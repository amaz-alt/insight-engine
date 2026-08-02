import fs from "node:fs";

import { chromium } from "playwright";

import { config } from "./config.mjs";
import { log } from "./logger.mjs";
import { pause } from "./human.mjs";

let context = null;
let page = null;

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
};

/** Launch (or relaunch) Chrome on the persistent profile. Survives crashes. */
export async function getPage() {
  if (page && !page.isClosed()) return page;

  fs.mkdirSync(config.profileDir, { recursive: true });
  // Clear stale singleton locks left behind by a VPS reboot or a hard kill.
  for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(`${config.profileDir}/${lock}`, { force: true });
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

  try {
    context = await chromium.launchPersistentContext(config.profileDir, {
      headless: config.headless,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
      timezoneId: process.env.TZ || undefined,
      ignoreDefaultArgs: ["--enable-automation"],
      args,
    });
  } catch (error) {
    state.chromeStatus = "failed";
    log.error("chrome.launch_failed", {
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
    state.chromeStatus = "crashed";
    page = null;
    context = null;
    log.warn("chrome.closed", {});
  });

  page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(45_000);
  state.chromeStatus = "running";
  log.info("chrome.started", {
    headless: config.headless,
    profile: config.profileDir,
    executablePath: executablePath ?? "(playwright default)",
  });
  return page;
}


export async function closeBrowser() {
  try {
    await context?.close();
  } catch {
    /* ignore */
  }
  page = null;
  context = null;
  state.chromeStatus = "stopped";
}

/** Kill and relaunch Chrome — used after a crash or a "restart" command. */
export async function restartBrowser(reason) {
  state.chromeRestarts += 1;
  log.warn("chrome.restart", { reason });
  await closeBrowser();
  await pause(2000, 5000);
  return getPage();
}

/** True when the persistent profile still holds a valid Facebook session. */
export async function checkSession(p) {
  await p.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
  await pause(2000, 4000);
  const loggedOut =
    (await p.locator('input[name="pass"]').count()) > 0 ||
    /login|checkpoint/.test(new URL(p.url()).pathname);

  state.sessionStatus = loggedOut ? "needs_login" : "connected";
  if (!loggedOut) state.sessionValidatedAt = new Date().toISOString();

  // Facebook's long-lived cookie expiry is the best available hint.
  let expiresAt = null;
  try {
    const cookies = await p.context().cookies("https://www.facebook.com");
    const cUser = cookies.find((c) => c.name === "c_user" || c.name === "xs");
    if (cUser?.expires > 0) expiresAt = new Date(cUser.expires * 1000).toISOString();
  } catch {
    /* ignore */
  }
  return { loggedIn: !loggedOut, expiresAt };
}
