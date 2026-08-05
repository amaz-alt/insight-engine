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
