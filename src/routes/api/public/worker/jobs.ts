import { createFileRoute } from "@tanstack/react-router";

import { authorizeWorker, json } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const randomBetween = (min: number, max: number) =>
  Math.floor(min + Math.random() * Math.max(1, max - min));

/**
 * The worker polls this for its next batch of browser actions.
 * Due scan and publish work is queued here, then handed out in a
 * deliberately shuffled order with human-like delays attached.
 */
export const Route = createFileRoute("/api/public/worker/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeWorker(request);
        if (!auth.ok) return auth.response;
        const s = auth.settings;
        const now = new Date();

        // 1. Queue scans for enabled groups that are past their scan interval.
        const staleBefore = new Date(
          now.getTime() - s.scan_interval_hours * 3600_000,
        ).toISOString();
        const { data: staleGroups } = await supabaseAdmin
          .from("groups")
          .select("id, name, url, last_scanned_at")
          .eq("enabled", true)
          .or(`last_scanned_at.is.null,last_scanned_at.lt.${staleBefore}`);

        for (const g of staleGroups ?? []) {
          const { data: existing } = await supabaseAdmin
            .from("worker_jobs")
            .select("id")
            .eq("type", "scan_group")
            .in("status", ["queued", "claimed"])
            .contains("payload", { group_id: g.id })
            .maybeSingle();
          if (existing) continue;

          await supabaseAdmin.from("worker_jobs").insert({
            type: "scan_group",
            priority: 6,
            payload: { group_id: g.id, group_name: g.name, url: g.url },
          });
        }

        // 2. Queue publishes for scheduled posts that are due.
        const { data: due } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id, group_id, content_piece_id, groups(name, url, can_post), content_pieces(body)")
          .eq("status", "pending")
          .lte("scheduled_for", now.toISOString())
          .limit(10);

        const publishedToday = await supabaseAdmin
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("published_at", new Date(now.getTime() - 86_400_000).toISOString());
        let budget = Math.max(0, s.daily_post_limit - (publishedToday.count ?? 0));

        for (const item of due ?? []) {
          const group = item.groups as { name: string; url: string; can_post: boolean } | null;
          if (!group?.can_post) {
            await supabaseAdmin
              .from("scheduled_posts")
              .update({ status: "skipped", error: "Posting unavailable in this group" })
              .eq("id", item.id);
            continue;
          }
          if (budget <= 0) break;
          budget -= 1;

          await supabaseAdmin.from("worker_jobs").insert({
            type: "publish_post",
            priority: 3,
            payload: {
              scheduled_post_id: item.id,
              group_id: item.group_id,
              url: group.url,
              body: (item.content_pieces as { body: string } | null)?.body ?? "",
            },
          });
          await supabaseAdmin
            .from("scheduled_posts")
            .update({ status: "claimed", claimed_at: now.toISOString() })
            .eq("id", item.id);
        }

        // 3. Hand out a small batch, shuffled, with randomized human delays.
        const { data: queued } = await supabaseAdmin
          .from("worker_jobs")
          .select("id, type, payload, priority")
          .eq("status", "queued")
          .lte("scheduled_for", now.toISOString())
          .order("priority", { ascending: true })
          .limit(6);

        const batch = (queued ?? []).sort(() => Math.random() - 0.5);
        if (batch.length) {
          await supabaseAdmin
            .from("worker_jobs")
            .update({ status: "claimed", claimed_at: now.toISOString() })
            .in(
              "id",
              batch.map((j) => j.id),
            );
        }

        return json({
          jobs: batch.map((job) => ({
            ...job,
            delay_before_seconds: randomBetween(s.min_delay_seconds, s.max_delay_seconds),
          })),
          behaviour: {
            window_start_hour: s.window_start_hour,
            window_end_hour: s.window_end_hour,
            timezone: s.timezone,
            min_delay_seconds: s.min_delay_seconds,
            max_delay_seconds: s.max_delay_seconds,
            daily_post_budget_left: budget,
          },
        });
      },
    },
  },
});
