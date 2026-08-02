/**
 * Facebook Growth OS — VPS browser worker (reference implementation)
 *
 * Run this on your single VPS. It is the ONLY external component:
 * it keeps one logged-in Chrome profile, polls Lovable Cloud for jobs,
 * scrapes monitored groups, publishes approved posts and reports back.
 *
 *   npm i playwright && npx playwright install chromium
 *   APP_URL=https://your-app.lovable.app WORKER_TOKEN=xxxx node worker.mjs
 *
 * First run opens a visible browser once so you can log into Facebook.
 * The profile is stored in ./fb-profile and reused forever after that.
 */
import { chromium } from "playwright";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN ?? "";
const PROFILE_DIR = process.env.PROFILE_DIR ?? "./fb-profile";
const HEADLESS = process.env.HEADLESS !== "false";

if (!APP_URL || !TOKEN) {
  console.error("Set APP_URL and WORKER_TOKEN");
  process.exit(1);
}

const api = async (path, body) => {
  const res = await fetch(`${APP_URL}/api/public/worker/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-token": TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

/** Scroll like a person reading, not like a scraper. */
async function humanScroll(page, passes = 4) {
  for (let i = 0; i < passes; i += 1) {
    await page.mouse.wheel(0, 500 + Math.random() * 900);
    await sleep(jitter(900, 2600));
  }
}

async function isLoggedIn(page) {
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  return !(await page.locator('input[name="pass"]').count());
}

async function scrapeGroup(page, job) {
  await page.goto(job.payload.url, { waitUntil: "domcontentloaded" });
  await sleep(jitter(2500, 5000));
  await humanScroll(page, 4 + Math.floor(Math.random() * 4));

  const posts = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div[role="article"]')) {
      const text = (el.innerText ?? "").trim();
      if (text.length < 60) continue;
      const link = el.querySelector('a[href*="/posts/"], a[href*="permalink"]');
      const numbers = [...text.matchAll(/(\d+)\s*(comments?|reactions?|likes?)/gi)];
      const pick = (word) =>
        Number(numbers.find((m) => m[2].toLowerCase().startsWith(word))?.[1] ?? 0);
      out.push({
        content: text.split("\n").slice(1).join("\n").slice(0, 4000),
        author_name: text.split("\n")[0]?.slice(0, 120) ?? null,
        permalink: link?.href ?? null,
        reactions: pick("reaction") || pick("like"),
        comments_count: pick("comment"),
      });
      if (out.length >= 25) break;
    }
    return out;
  });

  const canPost = (await page.locator('text=/write something|start a discussion/i').count()) > 0;

  const result = await api("ingest", {
    group_id: job.payload.group_id,
    can_post: canPost,
    posts,
  });
  return { scraped: posts.length, ...result };
}

async function publishPost(page, job) {
  await page.goto(job.payload.url, { waitUntil: "domcontentloaded" });
  await sleep(jitter(3000, 6000));

  const composer = page.locator('text=/write something|start a discussion/i').first();
  if (!(await composer.count())) throw new Error("Composer not available in this group");
  await composer.click();
  await sleep(jitter(1500, 3000));

  const box = page.locator('div[role="textbox"]').first();
  for (const line of job.payload.body.split("\n")) {
    await box.type(line, { delay: 18 + Math.random() * 45 });
    await box.press("Shift+Enter");
    await sleep(jitter(180, 700));
  }
  await sleep(jitter(1500, 4000));
  await page.locator('div[role="button"]:has-text("Post")').last().click();
  await sleep(jitter(4000, 8000));

  return { result_url: page.url() };
}

async function tick(page) {
  const healthy = await isLoggedIn(page);
  await api("heartbeat", { session_status: healthy ? "connected" : "needs_login" });
  if (!healthy) {
    console.warn("Facebook session needs login — start with HEADLESS=false and sign in once.");
    return;
  }

  const { jobs, behaviour } = await api("jobs", {});
  if (!jobs.length) return console.log("nothing due");

  for (const job of jobs) {
    await sleep(job.delay_before_seconds * 1000);
    const hour = new Date().getHours();
    if (job.type === "publish_post" && (hour < behaviour.window_start_hour || hour >= behaviour.window_end_hour)) {
      await api("complete", { job_id: job.id, status: "queued", error: "outside posting window" });
      continue;
    }

    try {
      const result = job.type === "scan_group" ? await scrapeGroup(page, job) : await publishPost(page, job);
      await api("complete", { job_id: job.id, status: "done", result, ...job.payload });
      console.log(job.type, "ok", result);
    } catch (error) {
      await api("complete", { job_id: job.id, status: "failed", error: String(error.message ?? error), ...job.payload });
      console.error(job.type, "failed", error.message);
    }
  }
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: HEADLESS,
  viewport: { width: 1366, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] ?? (await context.newPage());

while (true) {
  try {
    await tick(page);
  } catch (error) {
    console.error("tick failed", error.message);
  }
  await sleep(jitter(8 * 60_000, 20 * 60_000));
}
