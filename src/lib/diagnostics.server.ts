import { generateText } from "ai";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AI_MODEL, createLovableAiGatewayProvider, requireGatewayKey } from "./ai-gateway.server";

export type CheckStatus = "pass" | "warn" | "fail";

export type Check = {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  ms: number;
};

const TABLES = [
  "settings",
  "folders",
  "groups",
  "posts",
  "insights",
  "opportunities",
  "opportunity_posts",
  "content_pieces",
  "content_templates",
  "scheduled_posts",
  "worker_jobs",
  "activity_log",
] as const;

async function timed(
  id: string,
  group: string,
  label: string,
  run: () => Promise<{ status: CheckStatus; detail: string; hint?: string }>,
): Promise<Check> {
  const started = Date.now();
  try {
    const result = await run();
    return { id, group, label, ...result, ms: Date.now() - started };
  } catch (error) {
    return {
      id,
      group,
      label,
      status: "fail",
      detail: error instanceof Error ? error.message : "Unknown error",
      hint: "Unexpected failure while running this check.",
      ms: Date.now() - started,
    };
  }
}

const minutesSince = (value?: string | null) =>
  value ? Math.round((Date.now() - new Date(value).getTime()) / 60_000) : null;

/** Runs every dependency check the app relies on, in parallel. */
export async function runDiagnostics(): Promise<{ ranAt: string; checks: Check[] }> {
  const settingsPromise = supabaseAdmin.from("settings").select("*").eq("id", true).maybeSingle();

  const checks = await Promise.all([
    // ---- Database ----
    timed("db-connection", "Database", "Database reachable", async () => {
      const { error } = await settingsPromise;
      if (error) return { status: "fail", detail: error.message, hint: "The backend database rejected the query." };
      return { status: "pass", detail: "Connected and responding" };
    }),

    timed("db-settings-row", "Database", "Configuration row exists", async () => {
      const { data } = await settingsPromise;
      if (!data)
        return {
          status: "fail",
          detail: "No settings row found",
          hint: "Open Settings and save once to create the configuration row.",
        };
      return { status: "pass", detail: `Timezone ${data.timezone}` };
    }),

    timed("db-tables", "Database", "All tables readable", async () => {
      const results = await Promise.all(
        TABLES.map(async (table) => {
          const { error } = await supabaseAdmin.from(table).select("*", { head: true, count: "exact" });
          return { table, error: error?.message ?? null };
        }),
      );
      const broken = results.filter((r) => r.error);
      if (broken.length)
        return {
          status: "fail",
          detail: broken.map((b) => `${b.table}: ${b.error}`).join("; "),
          hint: "A table is missing or its grants/policies block access.",
        };
      return { status: "pass", detail: `${TABLES.length} tables present` };
    }),

    // ---- AI ----
    timed("ai-key", "AI", "AI gateway key present", async () => {
      try {
        requireGatewayKey();
        return { status: "pass", detail: "Key is configured" };
      } catch {
        return {
          status: "fail",
          detail: "Missing AI gateway key",
          hint: "AI analysis and content generation cannot run without it.",
        };
      }
    }),

    timed("ai-roundtrip", "AI", "AI model responds", async () => {
      const gateway = createLovableAiGatewayProvider(requireGatewayKey());
      const { text } = await generateText({
        model: gateway(AI_MODEL),
        prompt: 'Reply with the single word: ok',
      });
      const ok = /ok/i.test(text);
      return ok
        ? { status: "pass", detail: `${AI_MODEL} answered` }
        : { status: "warn", detail: `Unexpected reply: ${text.slice(0, 60)}` };
    }),

    // ---- Worker ----
    timed("worker-token", "Worker", "Worker token configured", async () => {
      const { data } = await settingsPromise;
      const token = data?.worker_token ?? "";
      if (token.length < 24)
        return {
          status: "fail",
          detail: "Token missing or too short",
          hint: "Generate a token in Settings and put it in the VPS .env file.",
        };
      return { status: "pass", detail: `${token.length} characters, never shown in full` };
    }),

    timed("worker-heartbeat", "Worker", "VPS heartbeat", async () => {
      const { data } = await settingsPromise;
      const age = minutesSince(data?.last_heartbeat_at);
      if (age === null)
        return {
          status: "fail",
          detail: "The worker has never checked in",
          hint: "Start the worker on the VPS and confirm APP_URL and WORKER_TOKEN match.",
        };
      if (age > 10)
        return {
          status: "fail",
          detail: `Last heartbeat ${age} minutes ago`,
          hint: "The VPS is offline or cannot reach the app.",
        };
      if (age > 3) return { status: "warn", detail: `Last heartbeat ${age} minutes ago` };
      return { status: "pass", detail: `Heartbeat ${age} minute(s) ago · version ${data?.worker_version ?? "unreported"}` };
    }),

    timed("worker-chrome", "Worker", "Chrome browser", async () => {
      const { data } = await settingsPromise;
      const status = data?.chrome_status ?? "unknown";
      if (status === "running") return { status: "pass", detail: "Chrome is running on the VPS" };
      if (status === "starting") return { status: "warn", detail: "Chrome is still starting" };
      return {
        status: "fail",
        detail: `Chrome reported as ${status}`,
        hint: "Restart the worker from the Worker page or on the VPS.",
      };
    }),

    timed("worker-session", "Worker", "Facebook session", async () => {
      const { data } = await settingsPromise;
      const status = data?.session_status ?? "disconnected";
      const validated = minutesSince(data?.session_validated_at);
      if (status === "connected")
        return {
          status: "pass",
          detail: validated === null ? "Logged in" : `Validated ${validated} minute(s) ago`,
        };
      if (status === "needs_login")
        return {
          status: "fail",
          detail: "Facebook wants a fresh login",
          hint: "Run login.sh on the VPS and sign in once.",
        };
      return { status: "warn", detail: `Session ${status.replace(/_/g, " ")}` };
    }),

    timed("worker-paused", "Worker", "Worker not paused", async () => {
      const { data } = await settingsPromise;
      return data?.worker_paused
        ? { status: "warn", detail: "Paused — no jobs are handed out", hint: "Resume it from the Worker page." }
        : { status: "pass", detail: "Accepting jobs" };
    }),

    // ---- Pipeline ----
    timed("pipeline-groups", "Pipeline", "Monitored groups", async () => {
      const { count } = await supabaseAdmin
        .from("groups")
        .select("*", { head: true, count: "exact" })
        .eq("enabled", true);
      if (!count)
        return {
          status: "warn",
          detail: "No enabled groups",
          hint: "Add at least one Facebook Group on the Groups page.",
        };
      return { status: "pass", detail: `${count} group(s) enabled` };
    }),

    timed("pipeline-scan", "Pipeline", "Recent scan", async () => {
      const { data } = await settingsPromise;
      const age = minutesSince(data?.last_scan_at);
      if (age === null) return { status: "warn", detail: "No successful scan recorded yet" };
      if (age > 24 * 60) return { status: "warn", detail: `Last scan ${Math.round(age / 60)} hour(s) ago` };
      return { status: "pass", detail: `Last scan ${age} minute(s) ago` };
    }),

    timed("pipeline-backlog", "Pipeline", "AI analysis backlog", async () => {
      const { count } = await supabaseAdmin
        .from("posts")
        .select("*", { head: true, count: "exact" })
        .eq("analyzed", false);
      if ((count ?? 0) > 200)
        return {
          status: "warn",
          detail: `${count} discussions waiting for AI`,
          hint: "The hourly cycle will catch up, or run it manually from the dashboard.",
        };
      return { status: "pass", detail: `${count ?? 0} discussion(s) waiting` };
    }),

    timed("jobs-stuck", "Pipeline", "No stuck jobs", async () => {
      const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
      const { count } = await supabaseAdmin
        .from("worker_jobs")
        .select("*", { head: true, count: "exact" })
        .eq("status", "claimed")
        .lt("claimed_at", cutoff);
      if (count)
        return {
          status: "warn",
          detail: `${count} job(s) claimed over 45 minutes ago`,
          hint: "Retry them from the Worker page.",
        };
      return { status: "pass", detail: "Queue is moving" };
    }),

    timed("jobs-failed", "Pipeline", "Failed jobs", async () => {
      const { count } = await supabaseAdmin
        .from("worker_jobs")
        .select("*", { head: true, count: "exact" })
        .eq("status", "failed");
      if ((count ?? 0) > 0)
        return { status: "warn", detail: `${count} failed job(s)`, hint: "Review and retry on the Worker page." };
      return { status: "pass", detail: "None" };
    }),

    // ---- Safety ----
    timed("safety-limits", "Safety", "Safety limits sane", async () => {
      const { data } = await settingsPromise;
      if (!data) return { status: "warn", detail: "No settings to validate" };
      const problems: string[] = [];
      if (data.min_delay_seconds > data.max_delay_seconds) problems.push("minimum delay exceeds maximum delay");
      if (data.daily_post_limit < 1) problems.push("daily post limit is zero");
      if (data.scans_per_hour < 1) problems.push("scans per hour is zero");
      if (data.max_groups_per_cycle < 1) problems.push("max groups per cycle is zero");
      if (problems.length)
        return { status: "warn", detail: problems.join("; "), hint: "Adjust these on the Settings page." };
      return {
        status: "pass",
        detail: `${data.daily_post_limit} posts/day · ${data.scans_per_hour} scans/hour · ${data.min_delay_seconds}-${data.max_delay_seconds}s delays`,
      };
    }),

    timed("safety-review", "Safety", "Review mode", async () => {
      const { data } = await settingsPromise;
      return data?.auto_publish
        ? { status: "warn", detail: "Auto publish is ON — content goes out without approval" }
        : { status: "pass", detail: "Manual approval required before publishing" };
    }),
  ]);

  return { ranAt: new Date().toISOString(), checks };
}
