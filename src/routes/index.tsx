import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Radar, Sparkle } from "lucide-react";
import { toast } from "sonner";

import { Badge, Button, Loading, Metric, Panel, PanelHeader, relativeTime } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { analyzeNewPosts, rebuildOpportunities } from "@/lib/ai.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Daily Briefing — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Today's scans, fresh demand signals, content awaiting approval and everything the browser worker published while you were away.",
      },
      { property: "og:title", content: "Daily Briefing — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Five minutes a day: review, approve, schedule, done.",
      },
    ],
  }),
  component: Dashboard,
});

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

function Dashboard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const analyze = useServerFn(analyzeNewPosts);
  const rebuild = useServerFn(rebuildOpportunities);

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const today = startOfToday();
      const [scans, opportunities, scheduled, published, awaiting, unanalysed] = await Promise.all([
        supabase
          .from("activity_log")
          .select("id", { count: "exact", head: true })
          .eq("kind", "scan")
          .gte("created_at", today),
        supabase
          .from("opportunities")
          .select("id", { count: "exact", head: true })
          .gte("created_at", today),
        supabase
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("published_at", today),
        supabase
          .from("content_pieces")
          .select("id", { count: "exact", head: true })
          .eq("status", "draft"),
        supabase.from("posts").select("id", { count: "exact", head: true }).is("analyzed_at", null),
      ]);
      return {
        scans: scans.count ?? 0,
        opportunities: opportunities.count ?? 0,
        scheduled: scheduled.count ?? 0,
        published: published.count ?? 0,
        awaiting: awaiting.count ?? 0,
        unanalysed: unanalysed.count ?? 0,
      };
    },
  });

  const { data: topOpportunities, isPending: oppPending } = useQuery({
    queryKey: ["top-opportunities"],
    queryFn: async () => {
      const { data } = await supabase
        .from("opportunities")
        .select("id, title, niche, demand_score, buying_intent, trend, frequency")
        .neq("status", "archived")
        .order("demand_score", { ascending: false })
        .limit(4);
      return data ?? [];
    },
  });

  const { data: drafts } = useQuery({
    queryKey: ["dashboard-drafts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_pieces")
        .select("id, kind, variant_label, hook, body, opportunities(title)")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });

  const { data: activity, isPending: activityPending } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_log")
        .select("id, kind, level, message, created_at")
        .order("created_at", { ascending: false })
        .limit(9);
      return data ?? [];
    },
  });

  const runCycle = useMutation({
    mutationFn: async () => {
      const analysed = await analyze();
      const ranked = await rebuild();
      return { ...analysed, ...ranked };
    },
    onSuccess: (result) => {
      toast.success(
        `Analysed ${result.analyzed ?? 0} discussions · ${result.opportunities ?? 0} opportunities ranked`,
      );
      queryClient.invalidateQueries();
      router.invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("content_pieces")
        .update({ status: "approved" })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Approved — ready to schedule");
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono">daily briefing</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {stats?.awaiting
              ? `${stats.awaiting} piece${stats.awaiting === 1 ? "" : "s"} waiting on you`
              : "Nothing needs you right now"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review, approve, schedule — then close the tab and let the worker run.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => runCycle.mutate()}
          disabled={runCycle.isPending}
          className="scanline"
        >
          <Radar />
          {runCycle.isPending ? "Reading Facebook…" : "Run AI cycle"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="scans today" value={stats?.scans ?? 0} sub={`${stats?.unanalysed ?? 0} posts pending AI`} />
        <Metric label="new opportunities" value={stats?.opportunities ?? 0} tone="primary" sub="discovered today" />
        <Metric label="scheduled" value={stats?.scheduled ?? 0} sub="queued for the worker" />
        <Metric label="published today" value={stats?.published ?? 0} sub="live in groups" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Needs your approval"
              hint="AI drafts held back until you say yes"
              action={
                <Link to="/content">
                  <Button size="sm" variant="ghost">
                    All content <ArrowUpRight />
                  </Button>
                </Link>
              }
            />
            {drafts?.length ? (
              <ul className="divide-y divide-border">
                {drafts.map((draft) => (
                  <li key={draft.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="primary">{draft.kind.replace(/_/g, " ")}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {(draft.opportunities as { title: string } | null)?.title ?? "Unlinked"}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                      {draft.body}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => approve.mutate(draft.id)}
                        disabled={approve.isPending}
                      >
                        Approve
                      </Button>
                      <Link to="/content">
                        <Button size="sm">Edit</Button>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Queue is clear. Generate content from a demand signal to fill it.
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Strongest demand right now"
              hint="Ranked by frequency, engagement and buying intent"
              action={
                <Link to="/insights">
                  <Button size="sm" variant="ghost">
                    All signals <ArrowUpRight />
                  </Button>
                </Link>
              }
            />
            {oppPending ? (
              <Loading />
            ) : (
              <ul className="divide-y divide-border">
                {(topOpportunities ?? []).map((o) => (
                  <li key={o.id}>
                    <Link
                      to="/insights/$id"
                      params={{ id: o.id }}
                      className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-secondary/50"
                    >
                      <span className="num w-10 text-xl font-semibold text-primary">
                        {o.demand_score}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{o.title}</span>
                        <span className="label-mono">
                          {o.niche} · {o.frequency} threads · intent {o.buying_intent}
                        </span>
                      </span>
                      <Badge tone={o.trend === "rising" ? "success" : o.trend === "cooling" ? "warning" : "neutral"}>
                        {o.trend}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel className="self-start">
          <PanelHeader title="Worker activity" hint="Every scan, publish and fault" />
          {activityPending ? (
            <Loading rows={5} />
          ) : (
            <ul className="divide-y divide-border">
              {(activity ?? []).map((entry) => (
                <li key={entry.id} className="flex gap-3 px-5 py-3">
                  <Sparkle
                    className={
                      entry.level === "error"
                        ? "mt-0.5 size-3.5 shrink-0 text-destructive"
                        : entry.level === "warning"
                          ? "mt-0.5 size-3.5 shrink-0 text-warning"
                          : "mt-0.5 size-3.5 shrink-0 text-primary"
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-foreground/90">{entry.message}</p>
                    <p className="label-mono mt-0.5">
                      {entry.kind} · {relativeTime(entry.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
