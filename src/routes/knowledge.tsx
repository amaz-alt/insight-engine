import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  EmptyState,
  Field,
  Input,
  Loading,
  Panel,
  PanelHeader,
  Select,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Search every scraped Facebook Group discussion, AI insight and generated post by keyword, group, niche, date range or buying intent.",
      },
      { property: "og:title", content: "Knowledge Base — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Nothing is ever lost — the whole research archive stays searchable.",
      },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [from, setFrom] = useState("");
  const [minIntent, setMinIntent] = useState("0");

  const { data: groups } = useQuery({
    queryKey: ["all-groups"],
    queryFn: async () => {
      const { data } = await supabase.from("groups").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data, isPending } = useQuery({
    queryKey: ["knowledge", q, groupId, from, minIntent],
    queryFn: async () => {
      let query = supabase
        .from("posts")
        .select(
          "id, content, author_name, reactions, comments_count, posted_at, permalink, groups(name), post_insights(pain_point, niche, buying_intent, urgency, sentiment, topics)",
        )
        .order("posted_at", { ascending: false })
        .limit(60);
      if (q.trim()) query = query.ilike("content", `%${q.trim()}%`);
      if (groupId) query = query.eq("group_id", groupId);
      if (from) query = query.gte("posted_at", new Date(from).toISOString());
      const { data } = await query;
      const rows = data ?? [];
      const threshold = Number(minIntent);
      if (!threshold) return rows;
      return rows.filter((row) => {
        const insight = Array.isArray(row.post_insights) ? row.post_insights[0] : row.post_insights;
        return (insight?.buying_intent ?? 0) >= threshold;
      });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">archive</p>
        <h1 className="mt-1 text-2xl font-semibold">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every discussion the worker has ever collected, with its AI reading attached.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Search" hint="Keyword, group, date range, buying intent" />
        <div className="grid gap-3 p-5 md:grid-cols-4">
          <Field label="keyword">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="pricing, burnout, funnel…" className="pl-8" />
            </div>
          </Field>
          <Field label="group">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">All groups</option>
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="posted after">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="min buying intent">
            <Select value={minIntent} onChange={(e) => setMinIntent(e.target.value)}>
              <option value="0">Any</option>
              <option value="40">40+</option>
              <option value="60">60+</option>
              <option value="80">80+</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Discussions" hint={`${data?.length ?? 0} results`} />
        {isPending ? (
          <Loading rows={5} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState title="Nothing matches" body="Try a looser keyword or clear the filters." />
        ) : (
          <ul className="divide-y divide-border">
            {(data ?? []).map((row) => {
              const insight = Array.isArray(row.post_insights) ? row.post_insights[0] : row.post_insights;
              return (
                <li key={row.id} className="px-5 py-4">
                  <p className="label-mono">
                    {(row.groups as { name: string } | null)?.name ?? "unknown group"} ·{" "}
                    {row.author_name ?? "member"} · {relativeTime(row.posted_at)} · {row.reactions} reactions ·{" "}
                    {row.comments_count} comments
                  </p>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {row.content}
                  </p>
                  {insight ? (
                    <div className="mt-3 space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {insight.niche ? <Badge tone="info">{insight.niche}</Badge> : null}
                        <Badge tone="primary">intent {insight.buying_intent}</Badge>
                        <Badge>urgency {insight.urgency}</Badge>
                        {insight.sentiment ? <Badge>{insight.sentiment}</Badge> : null}
                      </div>
                      {insight.pain_point ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">{insight.pain_point}</p>
                      ) : null}
                      {insight.topics?.length ? (
                        <p className="label-mono">{insight.topics.join(" · ")}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="label-mono mt-2">awaiting ai analysis</p>
                  )}
                  {row.permalink ? (
                    <a
                      href={row.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="label-mono mt-2 inline-block text-primary"
                    >
                      open on facebook →
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
