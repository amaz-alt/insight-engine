import { createFileRoute } from "@tanstack/react-router";

import { authorizeWorker, json, log } from "@/lib/worker.server";

/**
 * Automatic AI cycle. Called on a schedule by Lovable Cloud (pg_cron) with the
 * worker token, so insights and demand rankings stay fresh without the user
 * opening the app. Also safe to call manually from the VPS after a scan.
 */
export const Route = createFileRoute("/api/public/cron/ai-cycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeWorker(request);
        if (!auth.ok) return auth.response;

        try {
          const { analyzePendingPosts, clusterOpportunities } = await import("@/lib/ai.server");
          const analysed = await analyzePendingPosts(20);
          const ranked = analysed.analyzed > 0 ? await clusterOpportunities() : { opportunities: 0 };
          return json({ ok: true, ...analysed, ...ranked });
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI cycle failed";
          await log("insight", "error", `Automatic AI cycle failed: ${message}`);
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
