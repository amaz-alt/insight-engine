import { createFileRoute } from "@tanstack/react-router";

import { fingerprint, json, log, workerEndpoint } from "@/lib/worker.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

type IncomingPost = {
  fb_post_id?: string;
  author_name?: string;
  content: string;
  permalink?: string;
  posted_at?: string;
  reactions?: number;
  comments_count?: number;
  shares?: number;
  top_comments?: Json[];
};

/** The worker pushes scraped discussions here. Duplicates are never stored. */
export const Route = createFileRoute("/api/public/worker/ingest")({
  server: {
    handlers: {
      POST: workerEndpoint("ingest", async ({ request }) => {


        const body = (await request.json().catch(() => null)) as {
          group_id?: string;
          posts?: IncomingPost[];
          group_meta?: { member_count?: number; can_post?: boolean; activity_level?: string };
        } | null;

        if (!body?.group_id || !Array.isArray(body.posts)) {
          return json({ error: "group_id and posts are required" }, 400);
        }

        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("id, name")
          .eq("id", body.group_id)
          .maybeSingle();
        if (!group) return json({ error: "unknown group" }, 404);

        const rows = body.posts
          .filter((p) => typeof p.content === "string" && p.content.trim().length > 20)
          .slice(0, 200)
          .map((p) => ({
            group_id: group.id,
            fb_post_id: p.fb_post_id ?? null,
            content_hash: fingerprint(group.id, p.content),
            author_name: p.author_name ?? null,
            content: p.content.trim(),
            permalink: p.permalink ?? null,
            posted_at: p.posted_at ?? null,
            reactions: Number(p.reactions) || 0,
            comments_count: Number(p.comments_count) || 0,
            shares: Number(p.shares) || 0,
            top_comments: (p.top_comments ?? []).slice(0, 10),
          }));

        const { data: inserted, error } = await supabaseAdmin
          .from("posts")
          .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true })
          .select("id");
        if (error) return json({ error: error.message }, 500);

        const stored = inserted?.length ?? 0;
        const engagement =
          rows.length === 0
            ? 0
            : Math.min(
                100,
                Math.round(
                  rows.reduce((sum, r) => sum + r.reactions + r.comments_count * 2, 0) /
                    rows.length,
                ),
              );

        await supabaseAdmin
          .from("groups")
          .update({
            last_scanned_at: new Date().toISOString(),
            engagement_score: engagement,
            health: stored === 0 && rows.length === 0 ? "stale" : "ok",
            ...(body.group_meta?.member_count ? { member_count: body.group_meta.member_count } : {}),
            ...(typeof body.group_meta?.can_post === "boolean"
              ? { can_post: body.group_meta.can_post }
              : {}),
            ...(body.group_meta?.activity_level
              ? { activity_level: body.group_meta.activity_level }
              : {}),
          })
          .eq("id", group.id);

        await log(
          "scan",
          "success",
          `Scanned ${group.name} — ${stored} new post${stored === 1 ? "" : "s"}, ${rows.length - stored} duplicate${rows.length - stored === 1 ? "" : "s"} skipped`,
          group.id,
          { stored, seen: rows.length },
        );

        return json({ ok: true, stored, seen: rows.length });
      }),

    },
  },
});
