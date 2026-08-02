import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarPlus, Check, Copy, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  EmptyState,
  Loading,
  Panel,
  PanelHeader,
  Select,
  Textarea,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/content")({
  head: () => ({
    meta: [
      { title: "Content Studio — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Every AI-written value post, story post, engagement hook, comment and product description — edit, approve and send to the scheduler.",
      },
      { property: "og:title", content: "Content Studio — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Multiple variations per opportunity so no two posts are identical.",
      },
    ],
  }),
  component: ContentPage,
});

function ContentPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const { data, isPending } = useQuery({
    queryKey: ["content", status, kind],
    queryFn: async () => {
      let query = supabase
        .from("content_pieces")
        .select("id, kind, variant_label, hook, body, status, created_at, opportunity_id, opportunities(title)")
        .order("created_at", { ascending: false })
        .limit(80);
      if (status !== "all") query = query.eq("status", status);
      if (kind !== "all") query = query.eq("kind", kind);
      const { data } = await query;
      return data ?? [];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: { body?: string; status?: string } }) => {
      const { error } = await supabase.from("content_pieces").update(values).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">content studio</p>
        <h1 className="mt-1 text-2xl font-semibold">Generated assets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve what's good, tweak what's close, and the scheduler takes it from there.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Library"
          hint={`${data?.length ?? 0} pieces`}
          action={
            <div className="flex gap-2">
              <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-40 text-xs">
                <option value="all">All formats</option>
                <option value="value_post">Value post</option>
                <option value="story_post">Story post</option>
                <option value="educational_post">Educational</option>
                <option value="engagement_post">Engagement</option>
                <option value="promotional_post">Promotional</option>
                <option value="comment">Comment</option>
                <option value="lead_magnet">Lead magnet</option>
                <option value="product_description">Product description</option>
              </Select>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-32 text-xs">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
              </Select>
            </div>
          }
        />

        {isPending ? (
          <Loading rows={4} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No content yet"
            body="Open a demand signal and hit Generate content to draft variations."
            action={
              <Link to="/insights">
                <Button variant="primary" size="sm">
                  Browse demand
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {(data ?? []).map((piece) => {
              const value = edits[piece.id] ?? piece.body;
              const dirty = value !== piece.body;
              return (
                <div key={piece.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{piece.kind.replace(/_/g, " ")}</Badge>
                    <Badge
                      tone={
                        piece.status === "approved"
                          ? "success"
                          : piece.status === "published"
                            ? "info"
                            : piece.status === "scheduled"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {piece.status}
                    </Badge>
                    {piece.variant_label ? <span className="label-mono">{piece.variant_label}</span> : null}
                    {piece.opportunity_id ? (
                      <Link
                        to="/insights/$id"
                        params={{ id: piece.opportunity_id }}
                        className="truncate text-xs text-muted-foreground hover:text-primary"
                      >
                        {(piece.opportunities as { title: string } | null)?.title}
                      </Link>
                    ) : null}
                  </div>

                  {piece.hook ? (
                    <p className="mt-2 font-display text-sm font-semibold">{piece.hook}</p>
                  ) : null}

                  <Textarea
                    value={value}
                    rows={6}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [piece.id]: e.target.value }))}
                    className="mt-2"
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!dirty || update.isPending}
                      onClick={() => update.mutate({ id: piece.id, values: { body: value } })}
                    >
                      <Save /> Save edit
                    </Button>
                    {piece.status === "draft" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          update.mutate({
                            id: piece.id,
                            values: { status: "approved", ...(dirty ? { body: value } : {}) },
                          })
                        }
                      >
                        <Check /> Approve
                      </Button>
                    ) : null}
                    {piece.status === "approved" ? (
                      <Link to="/schedule">
                        <Button size="sm" variant="primary">
                          <CalendarPlus /> Schedule
                        </Button>
                      </Link>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(value);
                        toast.success("Copied");
                      }}
                    >
                      <Copy /> Copy
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
