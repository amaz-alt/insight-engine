import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Panel,
  PanelHeader,
  Select,
  formatDateTime,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Archive — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Search every scraped discussion, AI insight, generated content piece and published post by keyword, group, folder, date range, niche, pain point, buying intent and status.",
      },
      { property: "og:title", content: "Knowledge Archive — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Nothing is ever lost — the whole research archive stays searchable.",
      },
    ],
  }),
  component: KnowledgePage,
});

type Tab = "discussions" | "insights" | "content" | "published";

const TABS: { key: Tab; label: string }[] = [
  { key: "discussions", label: "Discussions" },
  { key: "insights", label: "AI insights" },
  { key: "content", label: "Generated content" },
  { key: "published", label: "Publish history" },
];

function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("discussions");
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [niche, setNiche] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minIntent, setMinIntent] = useState("0");
  const [status, setStatus] = useState("");

  const { data: groups } = useQuery({
    queryKey: ["all-groups"],
    queryFn: async () => {
      const { data } = await supabase.from("groups").select("id, name, folder_id").order("name");
      return data ?? [];
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["all-folders"],
    queryFn: async () => {
      const { data } = await supabase.from("folders").select("id, name").order("name");
      return data ?? [];
    },
  });

  const folderGroupIds = folderId
    ? (groups ?? []).filter((g) => g.folder_id === folderId).map((g) => g.id)
    : null;

  const fromIso = from ? new Date(from).toISOString() : null;
  const toIso = to ? new Date(new Date(to).getTime() + 86_400_000).toISOString() : null;

  const filters = [tab, q, groupId, folderId, niche, from, to, minIntent, status];

  const discussions = useQuery({
    enabled: tab === "discussions" || tab === "insights",
    queryKey: ["knowledge-posts", ...filters],
    queryFn: async () => {
      let query = supabase
        .from("posts")
        .select(
          "id, content, author_name, reactions, comments_count, posted_at, scraped_at, permalink, group_id, groups(name, folder_id), post_insights(pain_point, desired_outcome, objections, frustrations, niche, audience_type, buying_intent, urgency, sentiment, topics, confidence)",
        )
        .order("posted_at", { ascending: false })
        .limit(120);
      if (q.trim()) query = query.ilike("content", `%${q.trim()}%`);
      if (groupId) query = query.eq("group_id", groupId);
      else if (folderGroupIds) query = query.in("group_id", folderGroupIds.length ? folderGroupIds : ["none"]);
      if (fromIso) query = query.gte("posted_at", fromIso);
      if (toIso) query = query.lte("posted_at", toIso);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const threshold = Number(minIntent);
      return (data ?? []).filter((row) => {
        const insight = Array.isArray(row.post_insights) ? row.post_insights[0] : row.post_insights;
        if (tab === "insights" && !insight) return false;
        if (threshold && (insight?.buying_intent ?? 0) < threshold) return false;
        if (niche.trim() && !(insight?.niche ?? "").toLowerCase().includes(niche.trim().toLowerCase()))
          return false;
        return true;
      });
    },
  });

  const contentPieces = useQuery({
    enabled: tab === "content",
    queryKey: ["knowledge-content", ...filters],
    queryFn: async () => {
      let query = supabase
        .from("content_pieces")
        .select("id, kind, variant_label, hook, body, status, created_at, opportunities(title, niche, buying_intent)")
        .order("created_at", { ascending: false })
        .limit(120);
      if (q.trim()) query = query.ilike("body", `%${q.trim()}%`);
      if (status) query = query.eq("status", status);
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lte("created_at", toIso);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const threshold = Number(minIntent);
      return (data ?? []).filter((row) => {
        const o = row.opportunities as { niche: string | null; buying_intent: number } | null;
        if (threshold && (o?.buying_intent ?? 0) < threshold) return false;
        if (niche.trim() && !(o?.niche ?? "").toLowerCase().includes(niche.trim().toLowerCase()))
          return false;
        return true;
      });
    },
  });

  const published = useQuery({
    enabled: tab === "published",
    queryKey: ["knowledge-published", ...filters],
    queryFn: async () => {
      let query = supabase
        .from("scheduled_posts")
        .select(
          "id, status, scheduled_for, published_at, result_url, error, attempts, group_id, groups(name, folder_id), content_pieces(body, kind)",
        )
        .order("scheduled_for", { ascending: false })
        .limit(120);
      if (status) query = query.eq("status", status);
      if (groupId) query = query.eq("group_id", groupId);
      else if (folderGroupIds) query = query.in("group_id", folderGroupIds.length ? folderGroupIds : ["none"]);
      if (fromIso) query = query.gte("scheduled_for", fromIso);
      if (toIso) query = query.lte("scheduled_for", toIso);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (!q.trim()) return data ?? [];
      const needle = q.trim().toLowerCase();
      return (data ?? []).filter((row) =>
        ((row.content_pieces as { body: string } | null)?.body ?? "").toLowerCase().includes(needle),
      );
    },
  });

  const active =
    tab === "content" ? contentPieces : tab === "published" ? published : discussions;
  const count =
    tab === "content"
      ? contentPieces.data?.length
      : tab === "published"
        ? published.data?.length
        : discussions.data?.length;

  const statusOptions =
    tab === "published"
      ? ["pending", "claimed", "published", "failed", "skipped", "cancelled"]
      : ["draft", "approved", "scheduled", "published"];

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">archive</p>
        <h1 className="mt-1 text-2xl font-semibold">Knowledge archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every discussion, AI reading, drafted asset and publish attempt — kept forever, searchable.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? "primary" : "ghost"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="Filters"
          hint="Keyword, group, folder, dates, niche, intent, status"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ("");
                setGroupId("");
                setFolderId("");
                setNiche("");
                setFrom("");
                setTo("");
                setMinIntent("0");
                setStatus("");
              }}
            >
              Clear
            </Button>
          }
        />
        <div className="grid gap-3 p-5 md:grid-cols-4">
          <Field label="keyword">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="pricing, burnout, funnel…"
                className="pl-8"
              />
            </div>
          </Field>
          <Field label="folder">
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">All folders</option>
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="group">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">All groups</option>
              {(groups ?? [])
                .filter((g) => !folderId || g.folder_id === folderId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="niche / pain point">
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="coaching, etsy…" />
          </Field>
          <Field label="from">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="to">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="min buying intent">
            <Select value={minIntent} onChange={(e) => setMinIntent(e.target.value)}>
              <option value="0">Any</option>
              <option value="40">40+</option>
              <option value="60">60+</option>
              <option value="80">80+</option>
            </Select>
          </Field>
          <Field label="status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={tab === "discussions" || tab === "insights"}
            >
              <option value="">Any status</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={TABS.find((t) => t.key === tab)!.label} hint={`${count ?? 0} results`} />
        {active.isPending ? (
          <Loading rows={5} />
        ) : active.error ? (
          <ErrorState message={(active.error as Error).message} onRetry={() => void active.refetch()} />
        ) : (count ?? 0) === 0 ? (
          <EmptyState title="Nothing matches" body="Try a looser keyword or clear the filters." />
        ) : tab === "content" ? (
          <ul className="divide-y divide-border">
            {(contentPieces.data ?? []).map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{row.kind.replace(/_/g, " ")}</Badge>
                  <Badge tone={row.status === "published" ? "info" : row.status === "approved" ? "success" : "neutral"}>
                    {row.status}
                  </Badge>
                  {row.variant_label ? <span className="label-mono">{row.variant_label}</span> : null}
                  <span className="label-mono ml-auto">{formatDateTime(row.created_at)}</span>
                </div>
                {(row.opportunities as { title: string } | null)?.title ? (
                  <p className="label-mono mt-2">
                    from “{(row.opportunities as { title: string }).title}”
                  </p>
                ) : null}
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {row.body}
                </p>
              </li>
            ))}
          </ul>
        ) : tab === "published" ? (
          <ul className="divide-y divide-border">
            {(published.data ?? []).map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      row.status === "published"
                        ? "success"
                        : row.status === "failed"
                          ? "danger"
                          : row.status === "pending" || row.status === "claimed"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {row.status}
                  </Badge>
                  <span className="text-sm">
                    {(row.groups as { name: string } | null)?.name ?? "unknown group"}
                  </span>
                  <span className="label-mono ml-auto">
                    scheduled {formatDateTime(row.scheduled_for)}
                    {row.published_at ? ` · published ${relativeTime(row.published_at)}` : ""}
                    {row.attempts ? ` · ${row.attempts} attempts` : ""}
                  </span>
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {(row.content_pieces as { body: string } | null)?.body}
                </p>
                {row.error ? <p className="mt-2 text-xs text-destructive">{row.error}</p> : null}
                {row.result_url ? (
                  <a
                    href={row.result_url}
                    target="_blank"
                    rel="noreferrer"
                    className="label-mono mt-2 inline-block text-primary"
                  >
                    open on facebook →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-border">
            {(discussions.data ?? []).map((row) => {
              const insight = Array.isArray(row.post_insights) ? row.post_insights[0] : row.post_insights;
              return (
                <li key={row.id} className="px-5 py-4">
                  <p className="label-mono">
                    {(row.groups as { name: string } | null)?.name ?? "unknown group"} ·{" "}
                    {row.author_name ?? "member"} · {relativeTime(row.posted_at ?? row.scraped_at)} ·{" "}
                    {row.reactions} reactions · {row.comments_count} comments
                  </p>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {row.content}
                  </p>
                  {insight ? (
                    <div className="mt-3 space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {insight.niche ? <Badge tone="info">{insight.niche}</Badge> : null}
                        {insight.audience_type ? <Badge>{insight.audience_type}</Badge> : null}
                        <Badge tone="primary">intent {insight.buying_intent}</Badge>
                        <Badge>urgency {insight.urgency}</Badge>
                        <Badge>confidence {insight.confidence}%</Badge>
                        {insight.sentiment ? <Badge>{insight.sentiment}</Badge> : null}
                      </div>
                      {insight.pain_point ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="label-mono">pain · </span>
                          {insight.pain_point}
                        </p>
                      ) : null}
                      {insight.desired_outcome ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="label-mono">wants · </span>
                          {insight.desired_outcome}
                        </p>
                      ) : null}
                      {insight.objections?.length ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="label-mono">objections · </span>
                          {insight.objections.join(" · ")}
                        </p>
                      ) : null}
                      {insight.frustrations?.length ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="label-mono">frustrations · </span>
                          {insight.frustrations.join(" · ")}
                        </p>
                      ) : null}
                      {insight.topics?.length ? <p className="label-mono">{insight.topics.join(" · ")}</p> : null}
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
