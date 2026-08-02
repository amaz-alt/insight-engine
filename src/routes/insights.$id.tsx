import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  Loading,
  Panel,
  PanelHeader,
  ScoreBar,
  TrendBars,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { generateContent } from "@/lib/ai.functions";


export const Route = createFileRoute("/insights/$id")({
  head: () => ({
    meta: [
      { title: "Demand Signal — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Why this recurring Facebook Group problem is an opportunity, the discussions behind it, and the digital products that would solve it.",
      },
      { property: "og:title", content: "Demand Signal — Facebook Growth OS" },
      {
        property: "og:description",
        content: "The evidence behind an opportunity, plus one-click content generation.",
      },
    ],
  }),
  component: OpportunityDetail,
});

type ProductIdea = { name?: string; format?: string; why?: string };

const WINDOWS = [7, 30, 90] as const;

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

function OpportunityDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const generate = useServerFn(generateContent);
  const [days, setDays] = useState<number>(30);

  const { data: opportunity, isPending } = useQuery({
    queryKey: ["opportunity", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const { data: evidence } = useQuery({
    queryKey: ["opportunity-evidence", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_posts")
        .select(
          "posts(id, content, author_name, reactions, comments_count, posted_at, scraped_at, permalink, groups(name))",
        )
        .eq("opportunity_id", id)
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.posts).filter(Boolean);
    },
  });


  const { data: content } = useQuery({
    queryKey: ["opportunity-content", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_pieces")
        .select("id, kind, variant_label, body, status")
        .eq("opportunity_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const run = useMutation({
    mutationFn: () => generate({ data: { opportunityId: id } }),
    onSuccess: (result) => {
      toast.success(`${result.created ?? 0} content variations drafted`);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isPending) return <Loading rows={6} />;
  if (!opportunity) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">That signal no longer exists.</p>
        <Link to="/insights" className="mt-3 inline-block text-sm text-primary">
          Back to demand
        </Link>
      </div>
    );
  }

  const products = Array.isArray(opportunity.recommended_products)
    ? (opportunity.recommended_products as ProductIdea[])
    : [];

  return (
    <div className="space-y-6">
      <Link to="/insights" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Demand signals
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">demand {opportunity.demand_score}</Badge>
            <Badge tone={opportunity.trend === "rising" ? "success" : "neutral"}>{opportunity.trend}</Badge>
            {opportunity.niche ? <Badge tone="info">{opportunity.niche}</Badge> : null}
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-tight">{opportunity.title}</h1>
          {opportunity.summary ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{opportunity.summary}</p>
          ) : null}
        </div>
        <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
          <Wand2 />
          {run.isPending ? "Writing…" : "Generate content"}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Panel className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <ScoreBar value={opportunity.buying_intent} label="buying intent" />
              <ScoreBar value={opportunity.urgency} label="urgency" />
              <ScoreBar value={opportunity.confidence} label="confidence" />
            </div>
            {opportunity.pain_point ? (
              <div>
                <p className="label-mono">pain point</p>
                <p className="mt-1 text-sm leading-relaxed">{opportunity.pain_point}</p>
              </div>
            ) : null}
            {opportunity.why_it_matters ? (
              <div>
                <p className="label-mono">why this is an opportunity</p>
                <p className="mt-1 text-sm leading-relaxed">{opportunity.why_it_matters}</p>
              </div>
            ) : null}
            {opportunity.keywords.length ? (
              <div className="flex flex-wrap gap-1.5">
                {opportunity.keywords.map((k) => (
                  <Badge key={k}>{k}</Badge>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Demand over time"
              hint="how often this problem resurfaces"
              action={
                <div className="flex gap-1">
                  {WINDOWS.map((w) => (
                    <Button
                      key={w}
                      size="sm"
                      variant={days === w ? "primary" : "ghost"}
                      onClick={() => setDays(w)}
                    >
                      {w}d
                    </Button>
                  ))}
                </div>
              }
            />
            {(() => {
              const dates = (evidence ?? []).map((p) => p!.posted_at ?? p!.scraped_at);
              const points = bucketise(dates, days);
              const change = changePct(points);
              const engagement = (evidence ?? []).reduce(
                (sum, p) => sum + p!.reactions + p!.comments_count * 2,
                0,
              );
              return (
                <div className="space-y-3 p-5">
                  <TrendBars
                    points={points}
                    labels={[`${days}d ago`, ...Array(Math.max(0, points.length - 2)).fill(""), "today"]}
                    height={80}
                  />
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>
                      {points.reduce((a, b) => a + b, 0)} threads in window
                    </span>
                    <span className={change >= 0 ? "text-success" : "text-warning"}>
                      {change >= 0 ? "+" : ""}
                      {change}% frequency change
                    </span>
                    <span>{engagement} engagement points</span>
                    <span>confidence {opportunity.confidence}%</span>
                  </div>
                </div>
              );
            })()}
          </Panel>

          <Panel>
            <PanelHeader
              title="Original discussions"
              hint={`${evidence?.length ?? 0} threads generated this insight`}
            />
            <ul className="divide-y divide-border">
              {(evidence ?? []).slice(0, 25).map((post) => (
                <li key={post!.id} className="px-5 py-4">
                  <p className="label-mono">
                    {(post!.groups as { name: string } | null)?.name ?? "unknown group"} ·{" "}
                    {post!.author_name ?? "member"} · {relativeTime(post!.posted_at)}
                  </p>
                  <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {post!.content}
                  </p>
                  <p className="label-mono mt-2">
                    {post!.reactions} reactions · {post!.comments_count} comments
                  </p>
                  {post!.permalink ? (
                    <a
                      href={post!.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="label-mono mt-2 inline-block text-primary"
                    >
                      open the original on facebook →
                    </a>
                  ) : null}
                </li>
              ))}
              {!evidence?.length ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No linked discussions yet.
                </p>
              ) : null}
            </ul>
          </Panel>

        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Recommended products" hint="What would actually solve this" />
            <ul className="divide-y divide-border">
              {products.map((p, i) => (
                <li key={i} className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.format ? <Badge tone="primary">{p.format}</Badge> : null}
                  </div>
                  {p.why ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.why}</p> : null}
                </li>
              ))}
              {products.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Run an AI cycle to get product ideas.
                </p>
              ) : null}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader
              title="Content from this signal"
              hint={`${content?.length ?? 0} pieces`}
              action={
                <Link to="/content">
                  <Button size="sm" variant="ghost">
                    Studio
                  </Button>
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {(content ?? []).map((c) => (
                <li key={c.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{c.kind.replace(/_/g, " ")}</Badge>
                    <Badge tone={c.status === "approved" ? "success" : "neutral"}>{c.status}</Badge>
                    {c.variant_label ? <span className="label-mono">{c.variant_label}</span> : null}
                  </div>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-foreground/90">{c.body}</p>
                </li>
              ))}
              {!content?.length ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Nothing written for this signal yet.
                </p>
              ) : null}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
