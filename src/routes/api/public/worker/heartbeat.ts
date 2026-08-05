import { createFileRoute } from "@tanstack/react-router";

import { json, log, workerEndpoint } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * The VPS worker announces itself, reports Facebook/Chrome health and picks up
 * any one-shot command the operator triggered from the Worker Health screen.
 */
export const Route = createFileRoute("/api/public/worker/heartbeat")({
  server: {
    handlers: {
      POST: workerEndpoint("heartbeat", async ({ request, settings }) => {
        const body = (await request.json().catch(() => ({}))) as {
          session_status?: string;
          account_name?: string;
          worker_version?: string;
          chrome_status?: string;
          session_expires_at?: string;
          current_job_id?: string;
        };

        const status = ["connected", "disconnected", "needs_login"].includes(
          body.session_status ?? "",
        )
          ? body.session_status!
          : "connected";

        const now = new Date().toISOString();
        const command = settings.pending_command;


        await supabaseAdmin
          .from("settings")
          .update({
            session_status: status,
            last_heartbeat_at: now,
            last_sync_at: now,
            session_validated_at: status === "connected" ? now : auth.settings.session_validated_at,
            chrome_status: body.chrome_status ?? "running",
            ...(body.worker_version ? { worker_version: body.worker_version } : {}),
            ...(body.session_expires_at ? { session_expires_at: body.session_expires_at } : {}),
            // Commands are one-shot: handing it over clears it.
            pending_command: null,
            pending_command_at: null,
          })
          .eq("id", true);

        if (status === "needs_login") {
          await log("session", "warning", "Worker reports the Facebook session needs a re-login");
        }
        if (command) {
          await log("worker", "info", `Worker picked up command: ${command}`);
        }

        return json({
          ok: true,
          command: command ?? null,
          paused: auth.settings.worker_paused,
          settings: auth.settings,
        });
      },
    },
  },
});
