import { createFileRoute } from "@tanstack/react-router";

import {
  inPostingWindow,
  inQuietHours,
  json,
  log,
  reclaimStaleWork,
  workerEndpoint,
} from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const randomBetween = (min: number, max: number) =>
  Math.floor(min + Math.random() * Math.max(1, max - min));

/**
 * The worker polls this for its next batch of browser actions.
 *
 * Everything that protects the Facebook account is enforced here, server-side,
 * so a modified or misbehaving worker can never exceed the limits: stale work is
 * reclaimed first, then scan and publish work is queued inside the hourly /
 * daily budgets, the posting window, quiet hours, the minimum pacing gap and the
 * duplicate-content guard, and finally handed out shuffled with human delays.
 */
export const Route = createFileRoute("/api/public/worker/jobs")({
  server: {
    handlers: {
      POST: workerEndpoint("jobs", async ({ settings: s }) => {
        const now = new Date();

        if (s.worker_paused) {
          return json({ jobs: [], paused: true, reason: "worker paused from the app" });
        }

        // ── 0. Recover anything a crashed worker left claimed ───────────
        const recovery = await reclaimStaleWork(s, now);

        // Accounts drive everything: work is only ever handed out for an
        // account that is enabled and signed into Facebook.
        const { data: accountRows } = await supabaseAdmin
          .from("accounts")
          .select("id, name, profile_dir, enabled, session_status, needs_login, pending_command")
          .order("created_at");
        const accounts = accountRows ?? [];
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const usable = (accountId: string | null) => {
          const account = accountId ? byId.get(accountId) : undefined;
          // Groups with no account fall back to the first usable one.
          const chosen =
            account ?? accounts.find((a) => a.enabled && a.session_status === "connected");
          if (!chosen?.enabled || chosen.session_status !== "connected") return null;
          return chosen;
        };

        // ── 1. Safety limit: scans per hour ─────────────────────────────
        const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
        const scansThisHour = await supabaseAdmin
          .from("worker_jobs")
          .select("id", { count: "exact", head: true })
          .eq("type", "scan_group")
          .gte("claimed_at", hourAgo);
        const scanBudget = Math.max(
          0,
          Math.min(s.scans_per_hour - (scansThisHour.count ?? 0), s.max_groups_per_cycle),
        );

        // Queue scans for enabled groups that are past their scan interval.
        const staleBefore = new Date(
          now.getTime() - s.scan_interval_hours * 3600_000,
        ).toISOString();
        const { data: staleGroups } = await supabaseAdmin
          .from("groups")
          .select("id, name, url, last_scanned_at, account_id")
          .eq("enabled", true)
          .or(`last_scanned_at.is.null,last_scanned_at.lt.${staleBefore}`)
          .order("last_scanned_at", { ascending: true, nullsFirst: true })
          .limit(Math.max(0, scanBudget));

        for (const g of staleGroups ?? []) {
          const account = usable(g.account_id);
          if (!account) continue;

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
            group_id: g.id,
            account_id: account.id,
            payload: {
              group_id: g.id,
              group_name: g.name,
              url: g.url,
              profile_dir: account.profile_dir,
              account_name: account.name,
            },
          });
        }


        // ── 2. Publish gating ───────────────────────────────────────────
        const quiet = inQuietHours(s, now);
        const inWindow = inPostingWindow(s, now);

        // Pacing: never hand out a publish sooner than min_delay_seconds after
        // the previous one, even if several posts are due at the same minute.
        const lastPublishAge = s.last_publish_at
          ? (now.getTime() - new Date(s.last_publish_at).getTime()) / 1000
          : Infinity;
        const pacingOk = lastPublishAge >= s.min_delay_seconds;

        // Daily cap counts published AND in-flight work, so concurrent polls
        // cannot both spend the last slot.
        const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
        const publishedToday = await supabaseAdmin
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("published_at", dayAgo);
        const inFlight = await supabaseAdmin
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "publishing");
        let budget = Math.max(
          0,
          s.daily_post_limit - (publishedToday.count ?? 0) - (inFlight.count ?? 0),
        );

        const publishAllowed = !quiet && inWindow && pacingOk && budget > 0;

        const { data: due } = publishAllowed
          ? await supabaseAdmin
              .from("scheduled_posts")
              .select(
                "id, group_id, content_piece_id, groups(name, url, can_post, enabled, account_id), content_pieces(body, status)",
              )
              .eq("status", "scheduled")
              .lte("scheduled_for", now.toISOString())
              .order("scheduled_for", { ascending: true })
              .limit(10)
          : { data: [] as never[] };

        for (const item of due ?? []) {
          const group = item.groups as {
            name: string;
            url: string;
            can_post: boolean;
            enabled: boolean;
            account_id: string | null;
          } | null;
          const piece = item.content_pieces as { body: string; status: string } | null;


          if (!group?.can_post || !group.enabled) {
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "skipped",
                error: group?.enabled
                  ? "Posting unavailable in this group"
                  : "Group is disabled",
              })
              .eq("id", item.id);
            continue;
          }

          if (!piece?.body?.trim()) {
            await supabaseAdmin
              .from("scheduled_posts")
              .update({ status: "failed", error: "The content is empty — nothing to publish" })
              .eq("id", item.id);
            await log("publish", "error", "Skipped a post with empty content", item.group_id);
            continue;
          }

          // Review mode: nothing unapproved ever reaches Facebook.
          if (!s.auto_publish && piece.status === "draft") {
            await supabaseAdmin
              .from("scheduled_posts")
              .update({ status: "draft", error: "Waiting for your approval" })
              .eq("id", item.id);
            await log(
              "publish",
              "warning",
              "Held a post back — content is not approved yet",
              item.group_id,
            );
            continue;
          }

          // Duplicate guard: the same content piece never lands in the same
          // group twice unless that is explicitly allowed.
          if (!s.allow_repost_same_content && item.content_piece_id) {
            const { count: alreadyThere } = await supabaseAdmin
              .from("scheduled_posts")
              .select("id", { count: "exact", head: true })
              .eq("group_id", item.group_id)
              .eq("content_piece_id", item.content_piece_id)
              .eq("status", "published");
            if ((alreadyThere ?? 0) > 0) {
              await supabaseAdmin
                .from("scheduled_posts")
                .update({
                  status: "skipped",
                  error: "This exact content was already published to this group",
                })
                .eq("id", item.id);
              await log(
                "publish",
                "warning",
                "Skipped a duplicate — that content is already live in this group",
                item.group_id,
              );
              continue;
            }
          }

          const account = usable(group.account_id);
          if (!account) {
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "skipped",
                error: "The Facebook account for this group is disabled or signed out",
              })
              .eq("id", item.id);
            await log(
              "publish",
              "warning",
              "Held a post back — that group's Facebook account is signed out",
              item.group_id,
            );
            continue;
          }

          if (budget <= 0) break;
          budget -= 1;

          await supabaseAdmin.from("worker_jobs").insert({
            type: "publish_post",
            priority: 3,
            group_id: item.group_id,
            account_id: account.id,
            payload: {
              scheduled_post_id: item.id,
              group_id: item.group_id,
              group_name: group.name,
              url: group.url,
              body: piece.body,
              profile_dir: account.profile_dir,
              account_name: account.name,
            },
          });

          await supabaseAdmin
            .from("scheduled_posts")
            .update({ status: "publishing", claimed_at: now.toISOString() })
            .eq("id", item.id);

          // One publish handed out per poll keeps the pacing gap honest.
          break;
        }

        // ── 3. Hand out a small batch, shuffled, with human delays ──────
        const { data: queued } = await supabaseAdmin
          .from("worker_jobs")
          .select("id, type, payload, priority, attempts")
          .eq("status", "queued")
          .lte("scheduled_for", now.toISOString())
          .order("priority", { ascending: true })
          .limit(6);

        const batch = (queued ?? []).sort(() => Math.random() - 0.5);
        const leaseUntil = new Date(
          now.getTime() + Math.max(2, s.job_lease_minutes) * 60_000,
        ).toISOString();
        if (batch.length) {
          await supabaseAdmin
            .from("worker_jobs")
            .update({
              status: "claimed",
              claimed_at: now.toISOString(),
              lease_expires_at: leaseUntil,
            })
            .in(
              "id",
              batch.map((j) => j.id),
            );
        }

        await supabaseAdmin
          .from("settings")
          .update({ last_sync_at: now.toISOString() })
          .eq("id", true);

        return json({
          jobs: batch.map((job) => ({
            ...job,
            lease_expires_at: leaseUntil,
            max_attempts: s.max_job_attempts,
            delay_before_seconds: randomBetween(s.min_delay_seconds, s.max_delay_seconds),
          })),
          recovery,
          behaviour: {
            window_start_hour: s.window_start_hour,
            window_end_hour: s.window_end_hour,
            quiet_hours_start: s.quiet_hours_start,
            quiet_hours_end: s.quiet_hours_end,
            in_quiet_hours: quiet,
            in_posting_window: inWindow,
            publish_allowed: publishAllowed,
            publish_blocked_reason: publishAllowed
              ? null
              : quiet
                ? "quiet hours"
                : !inWindow
                  ? "outside the posting window"
                  : !pacingOk
                    ? "minimum delay between posts not elapsed"
                    : "daily post limit reached",
            timezone: s.timezone,
            min_delay_seconds: s.min_delay_seconds,
            max_delay_seconds: s.max_delay_seconds,
            randomization_window_minutes: s.randomization_window_minutes,
            scans_per_hour: s.scans_per_hour,
            max_groups_per_cycle: s.max_groups_per_cycle,
            job_lease_minutes: s.job_lease_minutes,
            scan_budget_left: scanBudget,
            daily_post_budget_left: budget,
            auto_publish: s.auto_publish,
          },
        });
      }),
    },
  },
});
