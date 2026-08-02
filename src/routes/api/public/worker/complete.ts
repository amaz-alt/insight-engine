import { createFileRoute } from "@tanstack/react-router";

import { authorizeWorker, json, log } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_ATTEMPTS = 3;

/** The worker reports the outcome of a claimed job. */
export const Route = createFileRoute("/api/public/worker/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeWorker(request);
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => null)) as {
          job_id?: string;
          status?: "done" | "failed" | "queued";
          result_url?: string;
          error?: string;
        } | null;

        if (!body?.job_id) return json({ error: "job_id is required" }, 400);
        const failed = body.status === "failed";
        const requeued = body.status === "queued";

        const { data: job } = await supabaseAdmin
          .from("worker_jobs")
          .select("id, type, payload")
          .eq("id", body.job_id)
          .maybeSingle();
        if (!job) return json({ error: "unknown job" }, 404);

        const now = new Date().toISOString();

        await supabaseAdmin
          .from("worker_jobs")
          .update({
            status: requeued ? "queued" : failed ? "failed" : "done",
            ...(requeued ? { claimed_at: null } : {}),
            completed_at: requeued ? null : now,
            error: body.error ?? null,
            result: body.result_url ? { url: body.result_url } : null,
          })
          .eq("id", job.id);

        const payload = (job.payload ?? {}) as { scheduled_post_id?: string; group_id?: string };

        if (job.type === "publish_post" && payload.scheduled_post_id) {
          const { data: sp } = await supabaseAdmin
            .from("scheduled_posts")
            .select("attempts, content_piece_id")
            .eq("id", payload.scheduled_post_id)
            .maybeSingle();
          const attempts = (sp?.attempts ?? 0) + 1;
          const exhausted = attempts >= MAX_ATTEMPTS;

          await supabaseAdmin
            .from("scheduled_posts")
            .update({
              // Transient failures go back to scheduled so the worker retries;
              // after MAX_ATTEMPTS the row parks in failed for manual retry.
              status: requeued
                ? "scheduled"
                : failed
                  ? exhausted
                    ? "failed"
                    : "scheduled"
                  : "published",
              attempts,
              published_at: !failed && !requeued ? now : null,
              result_url: body.result_url ?? null,
              error: body.error ?? null,
              claimed_at: null,
            })
            .eq("id", payload.scheduled_post_id);

          if (!failed && !requeued) {
            if (sp?.content_piece_id) {
              await supabaseAdmin
                .from("content_pieces")
                .update({ status: "published" })
                .eq("id", sp.content_piece_id);
            }
            await supabaseAdmin.from("settings").update({ last_publish_at: now }).eq("id", true);
          }

          await log(
            "publish",
            failed ? (exhausted ? "error" : "warning") : requeued ? "info" : "success",
            failed
              ? `Publish attempt ${attempts}/${MAX_ATTEMPTS} failed: ${body.error ?? "unknown error"}`
              : requeued
                ? `Publish postponed: ${body.error ?? "outside window"}`
                : "Published a post to Facebook",
            payload.group_id ?? null,
          );
        } else if (job.type === "scan_group" && !failed && !requeued) {
          await supabaseAdmin.from("settings").update({ last_scan_at: now }).eq("id", true);
        } else if (failed) {
          await log("worker", "error", `${job.type} failed: ${body.error ?? "unknown error"}`);
        }

        return json({ ok: true });
      },
    },
  },
});
