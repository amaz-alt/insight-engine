import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BookmarkPlus,
  CalendarPlus,
  Check,
  Copy,
  Eye,
  RefreshCw,
  Save,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Loading,
  Panel,
  PanelHeader,
  ProgressBar,
  Select,
  Textarea,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { generateContent, regenerateSection } from "@/lib/ai.functions";

export const Route = createFileRoute("/content")({
  head: () => ({
    meta: [
      { title: "Content Studio — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Write, regenerate and preview every AI value post, story post, engagement hook, comment and product description before it publishes.",
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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateFor, setTemplateFor] = useState<string | null>(null);

  const regenerate = useServerFn(regenerateSection);
  const generate = useServerFn(generateContent);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["content", status, kind],
    queryFn: async () => {
      let query = supabase
        .from("content_pieces")
        .select("id, kind, variant_label, hook, body, status, created_at, opportunity_id, opportunities(title)")
        .order("created_at", { ascending: false })
        .limit(80);
      if (status !== "all") query = query.eq("status", status);
      if (kind !== "all") query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["content-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_templates")
        .select("id, name, kind, body")
        .order("created_at", { ascending: false });
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

  const rewrite = useMutation({
    mutationFn: async (input: { pieceId: string; section: "hook" | "body" }) => {
      setBusyId(input.pieceId);
      return regenerate({ data: { pieceId: input.pieceId, section: input.section } });
    },
    onSuccess: (_r, input) => {
      toast.success(`Regenerated the ${input.section}`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[input.pieceId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["content"] });
    },
    onError: (e: Error) => toast.error(e.message, { description: "The original text is untouched." }),
    onSettled: () => setBusyId(null),
  });

  const moreVariations = useMutation({
    mutationFn: async (opportunityId: string) =>
      generate({ data: { opportunityId, variations: 3 } }),
    onSuccess: (r) => {
      toast.success(`${r.created ?? 0} more variations drafted`);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTemplate = useMutation({
    mutationFn: async ({ name, kind: k, body }: { name: string; kind: string; body: string }) => {
      if (!name.trim()) throw new Error("Give the template a name");
      const { error } = await supabase
        .from("content_templates")
        .insert({ name: name.trim(), kind: k, body });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Saved to your template library");
      setTemplateFor(null);
      setTemplateName("");
      queryClient.invalidateQueries({ queryKey: ["content-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("content_templates").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-templates"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = (data ?? []).find((p) => p.id === previewId);

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">content studio</p>
        <h1 className="mt-1 text-2xl font-semibold">Generated assets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve what's good, regenerate what isn't, preview it exactly as Facebook will show it.
        </p>
      </div>

      {templates?.length ? (
        <Panel>
          <PanelHeader title="Template library" hint="Reusable structures you liked" />
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                <Badge tone="info">{t.kind.replace(/_/g, " ")}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(t.body);
                    toast.success("Template copied");
                  }}
                >
                  <Copy /> Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteTemplate.mutate(t.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

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
        ) : error ? (
          <EmptyState
            title="Content unavailable"
            body={error.message}
            action={<Button onClick={() => void refetch()}>Retry</Button>}
          />
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
              const busy = busyId === piece.id;
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
                    <span className="label-mono ml-auto">{value.length} chars</span>
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

                  {busy ? <div className="mt-3"><ProgressBar label="AI is rewriting this section" /></div> : null}

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
                      disabled={busy}
                      onClick={() => rewrite.mutate({ pieceId: piece.id, section: "hook" })}
                    >
                      <RefreshCw /> Regenerate hook
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => rewrite.mutate({ pieceId: piece.id, section: "body" })}
                    >
                      <Wand2 /> Regenerate body
                    </Button>
                    {piece.opportunity_id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={moreVariations.isPending}
                        onClick={() => moreVariations.mutate(piece.opportunity_id!)}
                      >
                        More variations
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreviewId(previewId === piece.id ? null : piece.id)}
                    >
                      <Eye /> Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setTemplateFor(templateFor === piece.id ? null : piece.id)}
                    >
                      <BookmarkPlus /> Save as template
                    </Button>
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

                  {templateFor === piece.id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Input
                        value={templateName}
                        placeholder="Template name"
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="max-w-xs"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={saveTemplate.isPending}
                        onClick={() =>
                          saveTemplate.mutate({ name: templateName, kind: piece.kind, body: value })
                        }
                      >
                        Save template
                      </Button>
                    </div>
                  ) : null}

                  {previewId === piece.id && preview ? (
                    <div className="mt-4 max-w-lg rounded-lg border border-border-strong bg-secondary/40 p-4">
                      <p className="label-mono mb-3">preview — as it appears in the group</p>
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-9 place-items-center rounded-full bg-primary/20 font-display text-xs font-semibold text-primary">
                          you
                        </span>
                        <div>
                          <p className="text-sm font-medium">Your account</p>
                          <p className="label-mono">just now · group post</p>
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                        {value}
                      </p>
                      <div className="mt-3 flex gap-4 border-t border-border pt-2">
                        {["Like", "Comment", "Share"].map((a) => (
                          <span key={a} className="text-xs text-muted-foreground">
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
