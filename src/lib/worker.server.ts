import { createHash } from "crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Settings = {
  worker_token: string;
  session_status: string;
  daily_post_limit: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  scan_interval_hours: number;
  timezone: string;
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Validates the VPS worker token (constant-time) and returns current settings. */
export async function authorizeWorker(request: Request) {
  const presented =
    request.headers.get("x-worker-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const { data } = await supabaseAdmin
    .from("settings")
    .select(
      "worker_token, session_status, daily_post_limit, min_delay_seconds, max_delay_seconds, window_start_hour, window_end_hour, scan_interval_hours, timezone",
    )
    .eq("id", true)
    .single();

  if (!data) return { ok: false as const, response: json({ error: "not_configured" }, 503) };

  const a = Buffer.from(presented);
  const b = Buffer.from(data.worker_token);
  const valid = a.length === b.length && createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex");
  if (!valid) return { ok: false as const, response: json({ error: "unauthorized" }, 401) };

  return { ok: true as const, settings: data as Settings };
}

export const fingerprint = (groupId: string, content: string) =>
  createHash("sha256")
    .update(`${groupId}::${content.replace(/\s+/g, " ").trim().toLowerCase()}`)
    .digest("hex");

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
