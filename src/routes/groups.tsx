import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  Field,
  Input,
  Loading,
  Panel,
  PanelHeader,
  Select,
  Toggle,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Monitored Groups — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Your library of monitored Facebook Groups with folders, posting permissions, activity level, engagement and last scan.",
      },
      { property: "og:title", content: "Monitored Groups — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Organise the groups the worker scans and publishes into.",
      },
    ],
  }),
  component: GroupsPage,
});

function GroupsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [folderId, setFolderId] = useState("");
  const [filter, setFilter] = useState("all");

  const { data: folders } = useQuery({
    queryKey: ["folders"],
    queryFn: async () => {
      const { data } = await supabase.from("folders").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: groups, isPending } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data } = await supabase
        .from("groups")
        .select("*, folders(name)")
        .order("engagement_score", { ascending: false });
      return data ?? [];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["groups"] });

  const addGroup = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !url.trim()) throw new Error("Name and group URL are both required");
      const { error } = await supabase.from("groups").insert({
        name: name.trim(),
        url: url.trim(),
        folder_id: folderId || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setName("");
      setUrl("");
      toast.success("Group added to the scan rotation");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, unknown> }) => {
      const { error } = await supabase.from("groups").update(values).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("groups").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Group removed");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const visible = (groups ?? []).filter((g) =>
    filter === "all" ? true : filter === "enabled" ? g.enabled : filter === "posting" ? g.can_post : !g.enabled,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">group library</p>
        <h1 className="mt-1 text-2xl font-semibold">Monitored groups</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {groups?.length ?? 0} groups tracked · {(groups ?? []).filter((g) => g.enabled).length} active
        </p>
      </div>

      <Panel>
        <PanelHeader title="Add a group" hint="Paste the group URL — the worker resolves the rest on its next pass" />
        <div className="grid gap-3 p-5 md:grid-cols-[1fr_1.3fr_auto_auto] md:items-end">
          <Field label="name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notion Templates & Systems" />
          </Field>
          <Field label="group url">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://facebook.com/groups/..." />
          </Field>
          <Field label="folder">
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Unfiled</option>
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={() => addGroup.mutate()} disabled={addGroup.isPending}>
            <Plus /> Add
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Library"
          hint="Toggle scanning and posting permission per group"
          action={
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-36 text-xs">
              <option value="all">All groups</option>
              <option value="enabled">Scanning</option>
              <option value="posting">Can post</option>
              <option value="paused">Paused</option>
            </Select>
          }
        />
        {isPending ? (
          <Loading rows={4} />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {(g.folders as { name: string } | null)?.name ? (
                      <Badge>{(g.folders as { name: string }).name}</Badge>
                    ) : null}
                    <Badge
                      tone={
                        g.health === "ok" ? "success" : g.health === "stale" ? "warning" : "danger"
                      }
                    >
                      {g.health.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="label-mono mt-1 truncate">
                    {g.member_count ? `${g.member_count.toLocaleString()} members · ` : ""}
                    {g.activity_level} activity · engagement {Math.round(Number(g.engagement_score))} · scanned{" "}
                    {relativeTime(g.last_scanned_at)}
                  </p>
                </div>

                <div className="flex items-center gap-5">
                  <div className="flex items-center gap-2">
                    <span className="label-mono">scan</span>
                    <Toggle
                      checked={g.enabled}
                      label="Scanning enabled"
                      onChange={(next) => patch.mutate({ id: g.id, values: { enabled: next } })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="label-mono">post</span>
                    <Toggle
                      checked={g.can_post}
                      label="Posting allowed"
                      onChange={(next) => patch.mutate({ id: g.id, values: { can_post: next } })}
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove group"
                    onClick={() => remove.mutate(g.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            {visible.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No groups match this filter.
              </p>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}
