import { createHash } from "crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type Settings = Database["public"]["Tables"]["settings"]["Row"];

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

  const { data } = await supabaseAdmin.from("settings").select("*").eq("id", true).single();

  if (!data) return { ok: false as const, response: json({ error: "not_configured" }, 503) };

  const a = Buffer.from(presented);
  const b = Buffer.from(data.worker_token);
  const valid =
    a.length === b.length &&
    createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex");
  if (!valid) return { ok: false as const, response: json({ error: "unauthorized" }, 401) };

  return { ok: true as const, settings: data as Settings };
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
