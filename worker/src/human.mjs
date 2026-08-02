/** Behaviour helpers that make the browser look like a person, not a scraper. */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const jitter = (min, max) => min + Math.random() * Math.max(0, max - min);
export const pause = (min, max) => sleep(jitter(min, max));
export const shuffle = (items) => [...items].sort(() => Math.random() - 0.5);

/** Scroll in uneven passes with reading pauses and the occasional scroll back up. */
export async function humanScroll(page, passes = 4) {
  for (let i = 0; i < passes; i += 1) {
    await page.mouse.wheel(0, 400 + Math.random() * 1000);
    await pause(900, 2800);
    if (Math.random() < 0.2) {
      await page.mouse.wheel(0, -(150 + Math.random() * 350));
      await pause(600, 1600);
    }
  }
}

/** Drift the cursor around so movement events are not perfectly static. */
export async function humanMouse(page) {
  const box = page.viewportSize() ?? { width: 1366, height: 900 };
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i += 1) {
    await page.mouse.move(Math.random() * box.width, Math.random() * box.height, {
      steps: 8 + Math.floor(Math.random() * 20),
    });
    await pause(120, 500);
  }
}

/** Type with variable cadence, thinking pauses and paragraph breaks. */
export async function humanType(locator, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const words = lines[i].split(" ");
    for (let w = 0; w < words.length; w += 1) {
      await locator.type(`${words[w]}${w === words.length - 1 ? "" : " "}`, {
        delay: 18 + Math.random() * 55,
      });
      if (Math.random() < 0.08) await pause(400, 1400); // brief think
    }
    if (i < lines.length - 1) {
      await locator.press("Shift+Enter");
      await pause(200, 800);
    }
  }
}

/** Exponential backoff with jitter, capped, for transient failures. */
export const backoffMs = (attempt, base = 5000, cap = 15 * 60_000) =>
  Math.min(cap, base * 2 ** Math.max(0, attempt - 1)) * (0.7 + Math.random() * 0.6);
