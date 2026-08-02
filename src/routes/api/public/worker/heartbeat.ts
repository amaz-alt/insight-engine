import { createFileRoute } from "@tanstack/react-router";

import { authorizeWorker, json, log } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** The VPS worker announces itself and reports Facebook session health. */
export const Route = createFileRoute("/api/public/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeWorker(request);
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          session_status?: string;
          account_name?: string;
        };

        const status = ["connected", "disconnected", "needs_login"].includes(
          body.session_status ?? "",
        )
          ? body.session_status!
          : "connected";

        await supabaseAdmin
          .from("settings")
          .update({
            session_status: status,
            last_heartbeat_at: new Date().toISOString(),
            ...(body.account_name ? { fb_account_name: body.account_name } : {}),
          })
          .eq("id", true);

        if (status === "needs_login") {
          await log("session", "warning", "Worker reports the Facebook session needs a re-login");
        }

        return json({ ok: true, settings: auth.settings });
      },
    },
  },
});
