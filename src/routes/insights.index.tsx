import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  Badge,
  EmptyState,
  Input,
  Loading,
  Panel,
  PanelHeader,
  ScoreBar,
  Select,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/insights/")({
  head: () => ({
    meta: [
      { title: "Demand Signals — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Recurring pain points clustered from Facebook Group discussions, ranked by frequency, buying intent, urgency and confidence.",
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

function InsightsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("demand_score");
  const [trend, setTrend] = useState("all");

  const { data, isPending } = useQuery({
    queryKey: ["opportunities", sort, trend],
    queryFn: async () => {
      let query = supabase
        .from("opportunities")
        .select("*")
        .neq("status", "archived")
        .order(sort, { ascending: false })
        .limit(60);
      if (trend !== "all") query = query.eq("trend", trend);
      const { data } = await query;
      return data ?? [];
    },
  });

  const rows = (data ?? []).filter((o) =>
    q.trim()
      ? `${o.title} ${o.pain_point ?? ""} ${o.niche ?? ""} ${o.keywords.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())
      : true,
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
              </Select>
            </div>
          }
        />

        {isPending ? (
          <Loading rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No demand signals yet"
            body="Run an AI cycle from the dashboard once the worker has scraped some discussions."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
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
                        {o.frequency} threads · confidence {o.confidence}% · {o.audience ?? "mixed audience"}
                      </p>
                    </div>
                    <div className="w-full max-w-[190px] space-y-2">
                      <ScoreBar value={o.buying_intent} label="buying intent" />
                      <ScoreBar value={o.urgency} label="urgency" />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
