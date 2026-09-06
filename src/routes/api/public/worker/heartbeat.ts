import { createFileRoute } from "@tanstack/react-router";

import { json, log, workerEndpoint } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AccountReport = {
  profile_dir?: string;
  session_status?: string;
  chrome_status?: string;
  session_expires_at?: string;
  last_scan_at?: string;
  last_publish_at?: string;
};

const SESSION_STATES = ["connected", "disconnected", "needs_login"];

/**
 * The VPS worker announces itself, reports Facebook/Chrome health for every
 * account it runs, and picks up any one-shot command the operator triggered.
 * The response tells the worker which accounts exist, so adding an account in
 * the app is enough — nothing has to be configured on the VPS.
 */
export const Route = createFileRoute("/api/public/worker/heartbeat")({
  server: {
    handlers: {
      POST: workerEndpoint("heartbeat", async ({ request, settings }) => {
        const body = (await request.json().catch(() => ({}))) as {
          accounts?: AccountReport[];
          session_status?: string;
          worker_version?: string;
          chrome_status?: string;
          session_expires_at?: string;
          current_job_id?: string;
        };

        const now = new Date().toISOString();
        const command = settings.pending_command;

        // ── Per-account health ──────────────────────────────────────────
        for (const report of body.accounts ?? []) {
          if (!report.profile_dir) continue;
          const status = SESSION_STATES.includes(report.session_status ?? "")
            ? report.session_status!
            : "disconnected";

          await supabaseAdmin
            .from("accounts")
            .update({
              session_status: status,
              needs_login: status !== "connected",
              chrome_status: report.chrome_status ?? "unknown",
              last_heartbeat_at: now,
              ...(status === "connected" ? { session_validated_at: now } : {}),
              ...(report.session_expires_at
                ? { session_expires_at: report.session_expires_at }
                : {}),
              ...(report.last_scan_at ? { last_scan_at: report.last_scan_at } : {}),
              ...(report.last_publish_at ? { last_publish_at: report.last_publish_at } : {}),
              // Commands are one-shot: reporting back clears them.
              pending_command: null,
              pending_command_at: null,
            })
            .eq("profile_dir", report.profile_dir);

          if (status === "needs_login") {
            await log(
              "session",
              "warning",
              `Account "${report.profile_dir}" is signed out of Facebook — it needs the one-time login again`,
            );
          }
        }

        // ── Worker-wide health (single row, drives the header/dashboard) ──
        const summary = SESSION_STATES.includes(body.session_status ?? "")
          ? body.session_status!
          : "connected";

        await supabaseAdmin
          .from("settings")
          .update({
            session_status: summary,
            last_heartbeat_at: now,
            last_sync_at: now,
            session_validated_at: summary === "connected" ? now : settings.session_validated_at,
            chrome_status: body.chrome_status ?? "running",
            ...(body.worker_version ? { worker_version: body.worker_version } : {}),
            ...(body.session_expires_at ? { session_expires_at: body.session_expires_at } : {}),
            pending_command: null,
            pending_command_at: null,
          })
          .eq("id", true);

        if (command) {
          await log("worker", "info", `Worker picked up command: ${command}`);
        }

        // What the worker needs to know: which accounts to keep signed in.
        const { data: accounts } = await supabaseAdmin
          .from("accounts")
          .select("id, name, profile_dir, enabled, pending_command, needs_login")
          .order("created_at");

        // Never echo the shared token back over the wire.
        const { worker_token: _token, ...safeSettings } = settings;

        return json({
          ok: true,
          command: command ?? null,
          paused: settings.worker_paused,
          accounts: accounts ?? [],
          settings: safeSettings,
        });
      }),
    },
  },
});
