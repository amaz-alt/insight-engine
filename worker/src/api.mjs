import { config } from "./config.mjs";
import { log } from "./logger.mjs";
import { backoffMs, sleep } from "./human.mjs";

/**
 * Authenticated call to the Lovable app. Retries transient failures
 * (network errors, 429, 5xx) with exponential backoff; 4xx fails fast.
 */
export async function api(endpoint, body, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      const res = await fetch(`${config.appUrl}/api/public/worker/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-token": config.token,
          "user-agent": `fb-growth-os-worker/${config.version}`,
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 401 || res.status === 403) {
        throw new Error(`unauthorized — check WORKER_TOKEN (${res.status})`);
      }
      if (!res.ok && res.status < 500 && res.status !== 429) {
        throw new Error(`${endpoint} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
      }
      if (!res.ok) throw Object.assign(new Error(`${endpoint} -> ${res.status}`), { retry: true });

      return await res.json();
    } catch (error) {
      lastError = error;
      const retryable = error.retry || error.name === "AbortError" || error.name === "TypeError";
      if (!retryable || attempt === retries) break;
      const wait = backoffMs(attempt, 2000, 60_000);
      log.warn("api.retry", { endpoint, attempt, wait_ms: Math.round(wait), error: error.message });
      await sleep(wait);
    }
  }
  log.error("api.failed", { endpoint, error: lastError?.message });
  throw lastError;
}
