import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Button,
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

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Publishing Queue — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Schedule approved posts across groups with rotated order, randomised times inside your window and full publish logs.",
      },
      { property: "og:title", content: "Publishing Queue — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Human-paced publishing: rotation, jitter, delays, no duplicates.",
      },
    ],
  }),
  component: SchedulePage,
});

function SchedulePage() {
  const queryClient = useQueryClient();
  const [pieceId, setPieceId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").eq("id", true).maybeSingle();
      return data;
    },
  });

  const { data: approved } = useQuery({
    queryKey: ["approved-content"],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_pieces")
        .select("id, kind, body, variant_label")
        .in("status", ["approved", "scheduled"])
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: groups } = useQuery({
    queryKey: ["postable-groups"],
    queryFn: async () => {
      const { data } = await supabase
        .from("groups")
        .select("id, name, can_post, enabled")
        .eq("can_post", true)
        .eq("enabled", true)
        .order("name");
      return data ?? [];
    },
  });

  const { data: queue, isPending } = useQuery({
    queryKey: ["queue"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_posts")
        .select(
          "id, status, scheduled_for, published_at, error, result_url, attempts, groups(name), content_pieces(kind, body)",
        )
        .order("scheduled_for", { ascending: true })
        .limit(60);
      return data ?? [];
    },
  });

  const schedule = useMutation({
    mutationFn: async () => {
      if (!pieceId) throw new Error("Pick a piece of content first");
      if (selected.length === 0) throw new Error("Select at least one group");

      const startHour = settings?.window_start_hour ?? 9;
      const endHour = settings?.window_end_hour ?? 21;
      const order = [...selected].sort(() => Math.random() - 0.5);
      const span = Math.max(1, endHour - startHour);

      const rows = order.map((groupId, index) => {
        const when = new Date(`${date}T00:00:00`);
        const slot = startHour + (span * index) / Math.max(1, order.length);
        when.setHours(Math.floor(slot), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
        return { content_piece_id: pieceId, group_id: groupId, scheduled_for: when.toISOString() };
      });

      const { error } = await supabase.from("scheduled_posts").insert(rows);
      if (error) throw new Error(error.message);
      await supabase.from("content_pieces").update({ status: "scheduled" }).eq("id", pieceId);
    },
    onSuccess: () => {
      toast.success(`Queued across ${selected.length} groups with randomised times`);
      setSelected([]);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("scheduled_posts").update({ status: "cancelled" }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Removed from the queue");
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">publishing</p>
        <h1 className="mt-1 text-2xl font-semibold">Schedule &amp; queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Posting window {settings?.window_start_hour ?? 9}:00–{settings?.window_end_hour ?? 21}:00 ·{" "}
          {settings?.daily_post_limit ?? 6} posts/day cap · {settings?.min_delay_seconds ?? 180}–
          {settings?.max_delay_seconds ?? 900}s between actions
        </p>
      </div>

      <Panel>
        <PanelHeader title="New schedule" hint="Order is rotated and times are jittered automatically" />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
            <Field label="content">
              <Select value={pieceId} onChange={(e) => setPieceId(e.target.value)}>
                <option value="">Select approved content…</option>
                {(approved ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind.replace(/_/g, " ")} · {c.body.slice(0, 60)}…
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => schedule.mutate()} disabled={schedule.isPending}>
              <CalendarPlus /> Queue
            </Button>
          </div>

          <div>
            <p className="label-mono mb-2">groups ({selected.length} selected)</p>
            <div className="flex flex-wrap gap-2">
              {(groups ?? []).map((g) => {
                const on = selected.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() =>
                      setSelected((prev) => (on ? prev.filter((x) => x !== g.id) : [...prev, g.id]))
                    }
                    className={
                      on
                        ? "rounded-full border border-primary/50 bg-primary/15 px-3 py-1 text-xs text-primary"
                        : "rounded-full border border-border-strong px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }
                  >
                    {g.name}
                  </button>
                );
              })}
              {!groups?.length ? (
                <p className="text-sm text-muted-foreground">
                  No groups have posting enabled —{" "}
                  <Link to="/groups" className="text-primary">
                    turn one on
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Queue &amp; history" hint="Every attempt the worker makes is logged" />
        {isPending ? (
          <Loading rows={4} />
        ) : (queue?.length ?? 0) === 0 ? (
          <EmptyState title="Queue empty" body="Approve content and schedule it into your groups." />
        ) : (
          <ul className="divide-y divide-border">
            {(queue ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <Badge
                  tone={
                    row.status === "published"
                      ? "success"
                      : row.status === "failed"
                        ? "danger"
                        : row.status === "cancelled"
                          ? "neutral"
                          : "warning"
                  }
                >
                  {row.status}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{(row.groups as { name: string } | null)?.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {(row.content_pieces as { body: string } | null)?.body.slice(0, 90)}…
                    </span>
                  </p>
                  <p className="label-mono mt-0.5">
                    {row.status === "published"
                      ? `published ${relativeTime(row.published_at)}`
                      : `for ${new Date(row.scheduled_for).toLocaleString()}`}
                    {row.attempts ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}` : ""}
                    {row.error ? ` · ${row.error}` : ""}
                  </p>
                </div>
                {row.status === "pending" ? (
                  <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => cancel.mutate(row.id)}>
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
