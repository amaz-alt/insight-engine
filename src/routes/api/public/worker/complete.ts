import { createFileRoute } from "@tanstack/react-router";

import { authorizeWorker, json, log } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** The worker reports the outcome of a claimed job. */
export const Route = createFileRoute("/api/public/worker/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeWorker(request);
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => null)) as {
          job_id?: string;
          status?: "done" | "failed";
          result_url?: string;
          error?: string;
        } | null;

        if (!body?.job_id) return json({ error: "job_id is required" }, 400);
        const failed = body.status === "failed";

        const { data: job } = await supabaseAdmin
          .from("worker_jobs")
          .select("id, type, payload")
          .eq("id", body.job_id)
          .maybeSingle();
        if (!job) return json({ error: "unknown job" }, 404);

        await supabaseAdmin
          .from("worker_jobs")
          .update({
            status: failed ? "failed" : "done",
            completed_at: new Date().toISOString(),
            error: body.error ?? null,
            result: body.result_url ? { url: body.result_url } : null,
          })
          .eq("id", job.id);

        const payload = (job.payload ?? {}) as { scheduled_post_id?: string; group_id?: string };

        if (job.type === "publish_post" && payload.scheduled_post_id) {
          await supabaseAdmin
            .from("scheduled_posts")
            .update({
              status: failed ? "failed" : "published",
              published_at: failed ? null : new Date().toISOString(),
              result_url: body.result_url ?? null,
              error: body.error ?? null,
            })
            .eq("id", payload.scheduled_post_id);

          await log(
            "publish",
            failed ? "error" : "success",
            failed
              ? `Publish failed: ${body.error ?? "unknown error"}`
              : "Published a post to Facebook",
            payload.group_id ?? null,
          );
        } else if (failed) {
          await log("worker", "error", `${job.type} failed: ${body.error ?? "unknown error"}`);
        }

        return json({ ok: true });
      },
    },
  },
});
