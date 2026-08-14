// `node:crypto` is required: the bare "crypto" specifier resolves to the Web
// Crypto global in the edge runtime, where `createHash` does not exist — that
// was the unhandled TypeError behind the HTTP 500 responses in production.
import { createHash, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type Settings = Database["public"]["Tables"]["settings"]["Row"];

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Validates the VPS worker token (constant-time) and returns current settings. */
export async function authorizeWorker(request: Request) {
  const presented =
    request.headers.get("x-worker-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("[worker] settings lookup failed", error.message);
    return { ok: false as const, response: json({ error: "settings_unavailable" }, 503) };
  }
  if (!data?.worker_token) {
    return { ok: false as const, response: json({ error: "not_configured" }, 503) };
  }

  // Hashing first keeps the compare constant-length as well as constant-time.
  const valid = presented.length > 0 && timingSafeEqual(sha256(presented), sha256(data.worker_token));
  if (!valid) return { ok: false as const, response: json({ error: "unauthorized" }, 401) };

  return { ok: true as const, settings: data as Settings };
}

type WorkerHandlerArgs = { request: Request; settings: Settings };

/**
 * Wraps a worker endpoint: authorizes the caller, then guarantees a JSON
 * response. Unexpected exceptions are logged with the endpoint name and
 * returned as a structured 500 instead of an opaque runtime crash.
 */
export function workerEndpoint(
  name: string,
  handler: (args: WorkerHandlerArgs) => Promise<Response>,
) {
  return async ({ request }: { request: Request }) => {
    try {
      const auth = await authorizeWorker(request);
      if (!auth.ok) return auth.response;
      return await handler({ request, settings: auth.settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(`[worker:${name}] unhandled error: ${message}`, stack);
      try {
        await log("worker", "error", `Endpoint ${name} failed: ${message}`);
      } catch {
        // logging must never mask the original failure
      }
      return json({ error: "internal_error", endpoint: name, message }, 500);
    }
  };
}


export const fingerprint = (groupId: string, content: string) =>
  createHash("sha256")
    .update(`${groupId}::${content.replace(/\s+/g, " ").trim().toLowerCase()}`)
    .digest("hex");

/** True when the current hour falls inside the configured quiet hours. */
export function inQuietHours(settings: Settings, now = new Date()) {
  const hour = now.getUTCHours();
  const { quiet_hours_start: start, quiet_hours_end: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function log(
  kind: string,
  level: string,
  message: string,
  groupId?: string | null,
  meta: Record<string, string | number | boolean | null> = {},
) {
  await supabaseAdmin.from("activity_log").insert({
    kind,
    level,
    message,
    group_id: groupId ?? null,
    meta,
  });
}

/** True when the current hour is inside the allowed posting window. */
export function inPostingWindow(settings: Settings, now = new Date()) {
  const hour = now.getUTCHours();
  const { window_start_hour: start, window_end_hour: end } = settings;
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Recovers work abandoned by a crashed / rebooted worker.
 *
 * A claimed job whose lease has run out is either handed back to the queue or —
 * once it has burned through `max_job_attempts` — parked as failed so it shows
 * up on the Worker Health screen instead of silently blocking the pipeline.
 * `scheduled_posts` stuck in `publishing` are released the same way, which is
 * what previously made a single crash freeze a post forever.
 */
export async function reclaimStaleWork(settings: Settings, now = new Date()) {
  const cutoff = new Date(
    now.getTime() - Math.max(2, settings.job_lease_minutes) * 60_000,
  ).toISOString();

  const { data: stale } = await supabaseAdmin
    .from("worker_jobs")
    .select("id, type, attempts, payload")
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);

  if (!stale?.length) return { reclaimed: 0, abandoned: 0 };

  let reclaimed = 0;
  let abandoned = 0;

  for (const job of stale) {
    const attempts = (job.attempts ?? 0) + 1;
    const exhausted = attempts >= settings.max_job_attempts;

    await supabaseAdmin
      .from("worker_jobs")
      .update({
        status: exhausted ? "failed" : "queued",
        attempts,
        claimed_at: null,
        lease_expires_at: null,
        completed_at: exhausted ? now.toISOString() : null,
        error: exhausted
          ? `Abandoned after ${attempts} attempts — the worker never reported back`
          : `Attempt ${attempts} timed out after ${settings.job_lease_minutes} min; requeued`,
      })
      .eq("id", job.id);

    const payload = (job.payload ?? {}) as { scheduled_post_id?: string; group_id?: string };
    if (payload.scheduled_post_id) {
      await supabaseAdmin
        .from("scheduled_posts")
        .update({
          status: exhausted ? "failed" : "scheduled",
          claimed_at: null,
          error: exhausted
            ? "The worker stopped responding before this post was confirmed"
            : "Worker timed out — will be tried again",
        })
        .eq("id", payload.scheduled_post_id)
        .eq("status", "publishing");
    }

    if (exhausted) abandoned += 1;
    else reclaimed += 1;
  }

  await log(
    "worker",
    abandoned ? "error" : "warning",
    `Recovered stalled work: ${reclaimed} job${reclaimed === 1 ? "" : "s"} requeued, ${abandoned} parked as failed`,
    null,
    { reclaimed, abandoned, lease_minutes: settings.job_lease_minutes },
  );

  return { reclaimed, abandoned };
}

