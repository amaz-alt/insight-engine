import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarPlus, Copy, GripVertical, RotateCcw, Save, X } from "lucide-react";
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
  Textarea,
  formatDateTime,
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
          "Draft, scheduled, publishing, published and failed posts in one queue — drag to reschedule, edit before publish, duplicate, cancel or retry.",
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

type QueueRow = {
  id: string;
  status: string;
  scheduled_for: string;
  published_at: string | null;
  error: string | null;
  result_url: string | null;
  attempts: number;
  content_piece_id: string;
  groups: { name: string } | null;
  content_pieces: { kind: string; body: string } | null;
};

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "primary" | "neutral"> = {
  published: "success",
  failed: "danger",
  publishing: "primary",
  scheduled: "warning",
  draft: "neutral",
  cancelled: "neutral",
  skipped: "neutral",
};

const LIVE_STATES = ["draft", "scheduled", "publishing", "failed"];

function SchedulePage() {
  const queryClient = useQueryClient();
  const [pieceId, setPieceId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

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

  const { data: queue, isPending, error, refetch } = useQuery({
    queryKey: ["queue"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select(
          "id, status, scheduled_for, published_at, error, result_url, attempts, content_piece_id, groups(name), content_pieces(kind, body)",
        )
        .order("scheduled_for", { ascending: true })
        .limit(120);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as QueueRow[];
    },
  });

  const schedule = useMutation({
    mutationFn: async () => {
      if (!pieceId) throw new Error("Pick a piece of content first");
      if (selected.length === 0) throw new Error("Select at least one group");

      const startHour = settings?.window_start_hour ?? 9;
      const endHour = settings?.window_end_hour ?? 21;
      const jitter = settings?.randomization_window_minutes ?? 45;
      const order = [...selected].sort(() => Math.random() - 0.5);
      const span = Math.max(1, endHour - startHour);

      const rows = order.map((groupId, index) => {
        const when = new Date(`${date}T00:00:00`);
        const slot = startHour + (span * index) / Math.max(1, order.length);
        when.setHours(Math.floor(slot), 0, 0, 0);
        when.setMinutes(Math.floor(Math.random() * jitter), Math.floor(Math.random() * 60));
        return {
          content_piece_id: pieceId,
          group_id: groupId,
          scheduled_for: when.toISOString(),
          status: "scheduled",
        };
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

  const patch = useMutation({
    mutationFn: async ({
      id,
      values,
      message,
    }: {
      id: string;
      values: {
        status?: string;
        attempts?: number;
        error?: string | null;
        scheduled_for?: string;
      };
      message: string;
    }) => {
      const { error } = await supabase.from("scheduled_posts").update(values).eq("id", id);
      if (error) throw new Error(error.message);
      return message;
    },
    onSuccess: (message) => {
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = useMutation({
    mutationFn: async (row: QueueRow) => {
      const { data: original } = await supabase
        .from("scheduled_posts")
        .select("content_piece_id, group_id")
        .eq("id", row.id)
        .single();
      if (!original) throw new Error("Could not read that queue item");
      const when = new Date(new Date(row.scheduled_for).getTime() + 3600_000 + Math.random() * 3600_000);
      const { error } = await supabase.from("scheduled_posts").insert({
        content_piece_id: original.content_piece_id,
        group_id: original.group_id,
        scheduled_for: when.toISOString(),
        status: "scheduled",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Duplicated an hour or so later");
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveBody = useMutation({
    mutationFn: async ({ pieceId: id, body }: { pieceId: string; body: string }) => {
      const { error } = await supabase.from("content_pieces").update({ body }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Post text updated before publishing");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Drag one queued item onto another to swap their publish slots.
  const swap = useMutation({
    mutationFn: async ({ a, b }: { a: QueueRow; b: QueueRow }) => {
      const [r1, r2] = await Promise.all([
        supabase.from("scheduled_posts").update({ scheduled_for: b.scheduled_for }).eq("id", a.id),
        supabase.from("scheduled_posts").update({ scheduled_for: a.scheduled_for }).eq("id", b.id),
      ]);
      if (r1.error || r2.error) throw new Error(r1.error?.message ?? r2.error!.message);
    },
    onSuccess: () => {
      toast.success("Rescheduled — slots swapped");
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = (queue ?? []).filter((r) =>
    tab === "queue" ? LIVE_STATES.includes(r.status) : !LIVE_STATES.includes(r.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">publishing</p>
        <h1 className="mt-1 text-2xl font-semibold">Schedule &amp; queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Posting window {settings?.window_start_hour ?? 9}:00–{settings?.window_end_hour ?? 21}:00 ·{" "}
          {settings?.daily_post_limit ?? 3} posts/day cap · {settings?.min_delay_seconds ?? 900}–
          {settings?.max_delay_seconds ?? 3600}s between actions ·{" "}
          {settings?.auto_publish ? "auto publish ON" : "review mode"}
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
              <CalendarPlus /> {schedule.isPending ? "Queueing…" : "Queue"}
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
        <PanelHeader
          title={tab === "queue" ? "Live queue" : "Publish history"}
          hint={
            tab === "queue"
              ? "Drag a row onto another to swap publish slots"
              : "Everything published, cancelled or skipped"
          }
          action={
            <div className="flex gap-1">
              {(["queue", "history"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tab === t ? "primary" : "ghost"}
                  onClick={() => setTab(t)}
                >
                  {t === "queue" ? "Queue" : "History"}
                </Button>
              ))}
            </div>
          }
        />
        {isPending ? (
          <Loading rows={4} />
        ) : error ? (
          <EmptyState
            title="Queue unavailable"
            body={error.message}
            action={<Button onClick={() => void refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={tab === "queue" ? "Queue empty" : "No history yet"}
            body={
              tab === "queue"
                ? "Approve content and schedule it into your groups."
                : "Published and cancelled posts land here."
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const draggable = tab === "queue" && ["draft", "scheduled"].includes(row.status);
              return (
                <li
                  key={row.id}
                  draggable={draggable}
                  onDragStart={() => setDragId(row.id)}
                  onDragOver={(e) => {
                    if (draggable && dragId && dragId !== row.id) e.preventDefault();
                  }}
                  onDrop={() => {
                    const source = (queue ?? []).find((r) => r.id === dragId);
                    if (source && source.id !== row.id) swap.mutate({ a: source, b: row });
                    setDragId(null);
                  }}
                  className={
                    dragId === row.id ? "bg-secondary/60 px-5 py-3.5" : "px-5 py-3.5 hover:bg-secondary/30"
                  }
                >
                  <div className="flex flex-wrap items-center gap-3">
                    {draggable ? (
                      <GripVertical className="size-4 cursor-grab text-muted-foreground" />
                    ) : null}
                    <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{row.groups?.name ?? "unknown group"}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {(row.content_pieces?.body ?? "").slice(0, 90)}…
                        </span>
                      </p>
                      <p className="label-mono mt-0.5">
                        {row.status === "published"
                          ? `published ${relativeTime(row.published_at)}`
                          : `for ${formatDateTime(row.scheduled_for)}`}
                        {row.attempts ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}` : ""}
                        {row.error ? ` · ${row.error}` : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {["draft", "scheduled"].includes(row.status) ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEditing(
                                editing?.id === row.id
                                  ? null
                                  : { id: row.id, body: row.content_pieces?.body ?? "" },
                              )
                            }
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => duplicate.mutate(row)}>
                            <Copy /> Duplicate
                          </Button>
                        </>
                      ) : null}
                      {row.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            patch.mutate({
                              id: row.id,
                              values: { status: "scheduled", error: null },
                              message: "Moved to scheduled",
                            })
                          }
                        >
                          Schedule
                        </Button>
                      ) : null}
                      {row.status === "failed" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            patch.mutate({
                              id: row.id,
                              values: {
                                status: "scheduled",
                                attempts: 0,
                                error: null,
                                scheduled_for: new Date(Date.now() + 300_000).toISOString(),
                              },
                              message: "Retrying in a few minutes",
                            })
                          }
                        >
                          <RotateCcw /> Retry
                        </Button>
                      ) : null}
                      {LIVE_STATES.includes(row.status) && row.status !== "publishing" ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Cancel"
                          onClick={() =>
                            patch.mutate({
                              id: row.id,
                              values: { status: "cancelled" },
                              message: "Removed from the queue",
                            })
                          }
                        >
                          <X />
                        </Button>
                      ) : null}
                      {row.result_url ? (
                        <a
                          href={row.result_url}
                          target="_blank"
                          rel="noreferrer"
                          className="label-mono self-center text-primary"
                        >
                          view →
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {editing?.id === row.id ? (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        rows={6}
                        value={editing.body}
                        onChange={(e) => setEditing({ id: row.id, body: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={saveBody.isPending}
                          onClick={() =>
                            saveBody.mutate({ pieceId: row.content_piece_id, body: editing.body })
                          }
                        >
                          <Save /> Save text
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                      <p className="label-mono">
                        editing the underlying content piece — every queued copy uses this text
                      </p>
                    </div>
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
