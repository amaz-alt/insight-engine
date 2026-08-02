import { api } from "./api.mjs";
import { log } from "./logger.mjs";
import { humanScroll, humanMouse, humanType, pause } from "./human.mjs";
import { state } from "./browser.mjs";

/** Scrape a monitored group: posts, engagement, top comments, posting rights. */
export async function scanGroup(page, job) {
  const { url, group_id: groupId, group_name: name } = job.payload;
  log.info("scan.start", { job: job.id, group: name ?? groupId });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await pause(2500, 5000);
  await humanMouse(page);
  await humanScroll(page, 4 + Math.floor(Math.random() * 5));

  const scraped = await page.evaluate(() => {
    const num = (text, word) =>
      Number(
        [...text.matchAll(/([\d.,KkMm]+)\s*(comments?|reactions?|likes?|shares?)/g)].find((m) =>
          m[2].toLowerCase().startsWith(word),
        )?.[1]?.replace(/[.,]/g, "") ?? 0,
      ) || 0;

    const posts = [];
    for (const el of document.querySelectorAll('div[role="article"]')) {
      const text = (el.innerText ?? "").trim();
      if (text.length < 60) continue;
      const lines = text.split("\n").filter(Boolean);
      const link = el.querySelector('a[href*="/posts/"], a[href*="permalink"], a[href*="/groups/"][href*="/posts"]');
      const time = el.querySelector("abbr[data-utime]")?.getAttribute("data-utime");
      posts.push({
        author_name: lines[0]?.slice(0, 120) ?? null,
        content: lines.slice(1).join("\n").slice(0, 4000),
        permalink: link?.href ?? null,
        posted_at: time ? new Date(Number(time) * 1000).toISOString() : null,
        reactions: num(text, "reaction") || num(text, "like"),
        comments_count: num(text, "comment"),
        shares: num(text, "share"),
        top_comments: lines
          .slice(-6)
          .filter((l) => l.length > 25)
          .slice(0, 5)
          .map((body) => ({ body })),
      });
      if (posts.length >= 25) break;
    }

    const memberText = document.body.innerText.match(/([\d.,KkMm]+)\s*members/);
    return {
      posts,
      member_count: memberText ? Number(memberText[1].replace(/[.,]/g, "")) || null : null,
    };
  });

  const canPost =
    (await page.locator('text=/write something|start a discussion|create a post/i').count()) > 0;

  const result = await api("ingest", {
    group_id: groupId,
    posts: scraped.posts,
    group_meta: {
      can_post: canPost,
      member_count: scraped.member_count ?? undefined,
      activity_level:
        scraped.posts.length >= 15 ? "high" : scraped.posts.length >= 6 ? "medium" : "low",
    },
  });

  state.lastScanAt = new Date().toISOString();
  log.info("scan.done", { job: job.id, seen: scraped.posts.length, stored: result.stored });
  return { seen: scraped.posts.length, stored: result.stored, can_post: canPost };
}

/** Publish an approved post into a group with human-like composing. */
export async function publishPost(page, job) {
  const { url, body } = job.payload;
  if (!body?.trim()) throw new Error("Nothing to publish — the content body is empty");
  log.info("publish.start", { job: job.id, chars: body.length });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await pause(3000, 6000);
  await humanScroll(page, 1 + Math.floor(Math.random() * 2));

  const composer = page
    .locator('div[role="button"]:has-text("Write something"), div[role="button"]:has-text("Start a discussion"), div[role="button"]:has-text("Create a post")')
    .first();
  if (!(await composer.count())) throw new Error("Posting is unavailable in this group right now");

  await composer.click();
  await pause(1500, 3200);

  const box = page.locator('div[role="textbox"]').first();
  await box.waitFor({ state: "visible" });
  await box.click();
  await humanType(box, body);
  await pause(1800, 4500); // re-read before posting

  const submit = page.locator('div[role="button"]:has-text("Post"), button:has-text("Post")').last();
  await submit.click();
  await pause(5000, 9000);

  const failed = await page.locator("text=/something went wrong|couldn't post/i").count();
  if (failed) throw new Error("Facebook rejected the post — will retry later");

  state.lastPublishAt = new Date().toISOString();
  log.info("publish.done", { job: job.id, url: page.url() });
  return { result_url: page.url() };
}
