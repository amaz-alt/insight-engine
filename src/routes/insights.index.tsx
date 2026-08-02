import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Loading,
  Panel,
  PanelHeader,
  ScoreBar,
  Select,
  TrendBars,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/insights/")({
  head: () => ({
    meta: [
      { title: "Demand Signals — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Recurring pain points clustered from Facebook Group discussions, ranked by demand with 7/30/90 day trends, frequency change and confidence scoring.",
      },
      { property: "og:title", content: "Demand Signals — Facebook Growth OS" },
      {
        property: "og:description",
        content: "See which problems keep coming up — and what to build for them.",
      },
    ],
  }),
  component: InsightsPage,
});

const WINDOWS = { "7": 7, "30": 30, "90": 90 } as const;
type WindowKey = keyof typeof WINDOWS;

function bucketise(dates: (string | null)[], days: number) {
  const buckets = days <= 7 ? 7 : days <= 30 ? 15 : 18;
  const span = (days * 86_400_000) / buckets;
  const start = Date.now() - days * 86_400_000;
  const points = Array.from({ length: buckets }, () => 0);
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (t < start) continue;
    const i = Math.min(buckets - 1, Math.floor((t - start) / span));
    points[i] = (points[i] ?? 0) + 1;
  }
  return points;
}

function changePct(points: number[]) {
  const half = Math.floor(points.length / 2);
  const older = points.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = points.slice(half).reduce((a, b) => a + b, 0);
  if (!older) return recent ? 100 : 0;
  return Math.round(((recent - older) / older) * 100);
}

function InsightsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("demand_score");
  const [trend, setTrend] = useState("all");
  const [windowKey, setWindowKey] = useState<WindowKey>("30");
  const days = WINDOWS[windowKey];

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["opportunities", sort, trend],
    queryFn: async () => {
      let query = supabase
        .from("opportunities")
        .select("*")
        .neq("status", "archived")
        .order(sort, { ascending: false })
        .limit(60);
      if (trend !== "all") query = query.eq("trend", trend);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  // Timeline of the underlying discussions, so trends reflect real activity.
  const { data: timeline } = useQuery({
    queryKey: ["opportunity-timeline", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await supabase
        .from("opportunity_posts")
        .select("opportunity_id, posts(posted_at, scraped_at, reactions, comments_count)")
        .limit(4000);
      const map = new Map<string, { dates: (string | null)[]; engagement: number }>();
      for (const row of data ?? []) {
        const post = row.posts as {
          posted_at: string | null;
          scraped_at: string;
          reactions: number;
          comments_count: number;
        } | null;
        if (!post) continue;
        const when = post.posted_at ?? post.scraped_at;
        const entry = map.get(row.opportunity_id) ?? { dates: [], engagement: 0 };
        entry.dates.push(when);
        if (when >= since) entry.engagement += post.reactions + post.comments_count * 2;
        map.set(row.opportunity_id, entry);
      }
      return map;
    },
  });

  const rows = (data ?? []).filter((o) =>
    q.trim()
      ? `${o.title} ${o.pain_point ?? ""} ${o.niche ?? ""} ${o.keywords.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())
      : true,
  );

  const allPoints = bucketise(
    [...(timeline?.values() ?? [])].flatMap((v) => v.dates),
    days,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">demand engine</p>
        <h1 className="mt-1 text-2xl font-semibold">Opportunities ranked by demand</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clusters of the same problem appearing again and again across your groups.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Discussion volume"
          hint={`last ${days} days`}
          action={
            <div className="flex gap-1">
              {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={windowKey === k ? "primary" : "ghost"}
                  onClick={() => setWindowKey(k)}
                >
                  {k}d
                </Button>
              ))}
            </div>
          }
        />
        <div className="space-y-3 p-5">
          <TrendBars
            points={allPoints}
            labels={[`${days}d ago`, ...Array(Math.max(0, allPoints.length - 2)).fill(""), "today"]}
            height={84}
          />
          <p className="text-xs text-muted-foreground">
            {allPoints.reduce((a, b) => a + b, 0)} clustered discussions ·{" "}
            <span
              className={
                changePct(allPoints) >= 0 ? "text-success" : "text-warning"
              }
            >
              {changePct(allPoints) >= 0 ? "+" : ""}
              {changePct(allPoints)}%
            </span>{" "}
            vs the previous half of this window
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Signals"
          hint={`${rows.length} clusters`}
          action={
            <div className="flex gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search pain point, niche, keyword"
                className="h-8 w-56 text-xs"
              />
              <Select value={trend} onChange={(e) => setTrend(e.target.value)} className="h-8 w-28 text-xs">
                <option value="all">All trends</option>
                <option value="rising">Rising</option>
                <option value="steady">Steady</option>
                <option value="cooling">Cooling</option>
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 w-36 text-xs">
                <option value="demand_score">Demand score</option>
                <option value="frequency">Frequency</option>
                <option value="buying_intent">Buying intent</option>
                <option value="urgency">Urgency</option>
                <option value="confidence">Confidence</option>
              </Select>
            </div>
          }
        />

        {isPending ? (
          <Loading rows={5} />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No demand signals yet"
            body="Run an AI cycle from the dashboard once the worker has scraped some discussions."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => {
              const entry = timeline?.get(o.id);
              const points = bucketise(entry?.dates ?? [], days);
              const change = changePct(points);
              return (
                <li key={o.id}>
                  <Link
                    to="/insights/$id"
                    params={{ id: o.id }}
                    className="block px-5 py-4 transition-colors hover:bg-secondary/50"
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      <span className="num w-12 shrink-0 text-2xl font-semibold text-primary">
                        {o.demand_score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{o.title}</span>
                          <Badge
                            tone={
                              o.trend === "rising" ? "success" : o.trend === "cooling" ? "warning" : "neutral"
                            }
                          >
                            {o.trend}
                          </Badge>
                          {o.niche ? <Badge tone="info">{o.niche}</Badge> : null}
                        </div>
                        {o.pain_point ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{o.pain_point}</p>
                        ) : null}
                        <p className="label-mono mt-2">
                          {o.frequency} threads · confidence {o.confidence}% ·{" "}
                          <span className={change >= 0 ? "text-success" : "text-warning"}>
                            {change >= 0 ? "+" : ""}
                            {change}% frequency
                          </span>{" "}
                          · {entry?.engagement ?? 0} engagement · {o.audience ?? "mixed audience"}
                        </p>
                      </div>
                      <div className="w-24 shrink-0">
                        <TrendBars points={points} height={36} />
                      </div>
                      <div className="w-full max-w-[190px] space-y-2">
                        <ScoreBar value={o.buying_intent} label="buying intent" />
                        <ScoreBar value={o.urgency} label="urgency" />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
