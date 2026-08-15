import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Chrome,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  EmptyState,
  Loading,
  Metric,
  Panel,
  PanelHeader,
  StatusDot,
  formatDateTime,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/worker")({
  head: () => ({
    meta: [
      { title: "Worker Health — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Live status of the VPS browser worker: heartbeat, Chrome, Facebook session, running and queued jobs, failures and recent worker logs.",
      },
      { property: "og:title", content: "Worker Health — Facebook Growth OS" },
      {
        property: "og:description",
        content: "One glance tells you whether the automation is alive and healthy.",
      },
    ],
  }),
  component: WorkerPage,
});

const ONLINE_WINDOW_MS = 10 * 60_000;

function WorkerPage() {
  const queryClient = useQueryClient();

  const { data: settings, isPending, error, refetch } = useQuery({
    queryKey: ["settings"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["worker-jobs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("worker_jobs")
        .select("id, type, status, payload, error, claimed_at, completed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      return data ?? [];
    },
  });

  const { data: attention } = useQuery({
    queryKey: ["worker-attention"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_posts")
        .select("id, status, error, attempts, scheduled_for, groups(name)")
        .in("status", ["failed", "skipped", "publishing"])
        .order("scheduled_for", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const retryPost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          error: null,
          attempts: 0,
          claimed_at: null,
          scheduled_for: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Rescheduled — the worker picks it up on its next poll");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: logs } = useQuery({
    queryKey: ["worker-logs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_log")
        .select("id, kind, level, message, created_at")
        .in("kind", ["worker", "session", "scan", "publish"])
        .order("created_at", { ascending: false })
        .limit(25);
      return data ?? [];
    },
  });


  const command = useMutation({
    mutationFn: async (cmd: "validate_session" | "restart_worker" | "reconnect") => {
      const { error } = await supabase
        .from("settings")
        .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw new Error(error.message);
      await supabase.from("activity_log").insert({
        kind: "worker",
        level: "info",
        message: `Queued command for the worker: ${cmd.replace(/_/g, " ")}`,
      });
    },
    onSuccess: () => {
      toast.success("Command queued — the worker picks it up on its next heartbeat");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePause = useMutation({
    mutationFn: async (paused: boolean) => {
      const { error } = await supabase.from("settings").update({ worker_paused: paused }).eq("id", true);
      if (error) throw new Error(error.message);
      await supabase.from("activity_log").insert({
        kind: "worker",
        level: paused ? "warning" : "info",
        message: paused ? "Worker paused from the app" : "Worker resumed",
      });
    },
    onSuccess: (_d, paused) => {
      toast.success(paused ? "Worker paused — no new jobs handed out" : "Worker resumed");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requeue = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("worker_jobs")
        .update({ status: "queued", error: null, claimed_at: null, completed_at: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Job put back in the queue");
      queryClient.invalidateQueries({ queryKey: ["worker-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPending) return <Loading rows={6} />;
  if (error || !settings) {
    return (
      <EmptyState
        title="Worker state unavailable"
        body={error?.message ?? "No worker configuration found yet."}
        action={
          <Button onClick={() => void refetch()}>
            <RefreshCw /> Retry
          </Button>
        }
      />
    );
  }

  const heartbeatAge = settings.last_heartbeat_at
    ? Date.now() - new Date(settings.last_heartbeat_at).getTime()
    : Infinity;
  const online = heartbeatAge < ONLINE_WINDOW_MS;
  const running = (jobs ?? []).filter((j) => j.status === "claimed");
  const queued = (jobs ?? []).filter((j) => j.status === "queued");
  const failed = (jobs ?? []).filter((j) => j.status === "failed");

  const sessionTone =
    settings.session_status === "connected"
      ? "success"
      : settings.session_status === "needs_login"
        ? "warning"
        : "neutral";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono">infrastructure</p>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-semibold">
            <StatusDot tone={online ? (settings.worker_paused ? "warning" : "success") : "danger"} />
            {settings.worker_paused
              ? "Worker paused"
              : online
                ? "Worker online"
                : "Worker offline"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Heartbeat {relativeTime(settings.last_heartbeat_at)} · version{" "}
            {settings.worker_version ?? "unreported"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => command.mutate("validate_session")} disabled={command.isPending}>
            <ShieldCheck /> Validate session
          </Button>
          <Button onClick={() => command.mutate("reconnect")} disabled={command.isPending}>
            <RefreshCw /> Reconnect
          </Button>
          <Button onClick={() => command.mutate("restart_worker")} disabled={command.isPending}>
            <RotateCcw /> Restart worker
          </Button>
          <Button
            variant={settings.worker_paused ? "primary" : "danger"}
            onClick={() => togglePause.mutate(!settings.worker_paused)}
            disabled={togglePause.isPending}
          >
            {settings.worker_paused ? <PlayCircle /> : <PauseCircle />}
            {settings.worker_paused ? "Resume worker" : "Pause worker"}
          </Button>
        </div>
      </div>

      {!online ? (
        <Panel className="border-warning/40 bg-warning/5 px-5 py-4">
          <p className="text-sm text-warning">
            No heartbeat in the last 10 minutes. The app keeps working — scheduled posts simply wait
            until the VPS checks in again.
          </p>
        </Panel>
      ) : null}

      {settings.pending_command ? (
        <Panel className="border-primary/40 bg-primary/5 px-5 py-4">
          <p className="text-sm text-primary">
            Command <span className="font-mono">{settings.pending_command}</span> is waiting to be
            collected (queued {relativeTime(settings.pending_command_at)}).
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="running now" value={running.length} sub={running[0]?.type.replace(/_/g, " ") ?? "idle"} />
        <Metric label="queued jobs" value={queued.length} tone="primary" sub="waiting for the worker" />
        <Metric label="failed jobs" value={failed.length} sub="retry below" />
        <Metric
          label="last sync"
          value={relativeTime(settings.last_sync_at)}
          sub={formatDateTime(settings.last_sync_at)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Facebook session" hint="Credentials never leave the VPS" />
          <dl className="divide-y divide-border">
            {[
              [
                "session",
                <Badge key="s" tone={sessionTone}>
                  {settings.session_status.replace(/_/g, " ")}
                </Badge>,
              ],
              ["account label", settings.fb_account_name ?? "unnamed"],
              ["last validated", formatDateTime(settings.session_validated_at)],
              [
                "expires",
                settings.session_expires_at ? formatDateTime(settings.session_expires_at) : "not detectable",
              ],
              [
                "chrome",
                <span key="c" className="inline-flex items-center gap-1.5 text-sm">
                  <Chrome className="size-3.5 text-muted-foreground" />
                  {settings.chrome_status}
                </span>,
              ],
              ["last successful scan", formatDateTime(settings.last_scan_at)],
              ["last successful publish", formatDateTime(settings.last_publish_at)],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="label-mono">{label}</dt>
                <dd className="text-sm text-foreground/90">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Job queue" hint="Newest first" />
          {(jobs?.length ?? 0) === 0 ? (
            <EmptyState title="No jobs yet" body="Jobs appear as soon as a group is due for a scan." />
          ) : (
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
              {(jobs ?? []).map((job) => (
                <li key={job.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge
                    tone={
                      job.status === "done"
                        ? "success"
                        : job.status === "failed"
                          ? "danger"
                          : job.status === "claimed"
                            ? "primary"
                            : "neutral"
                    }
                  >
                    {job.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {job.type.replace(/_/g, " ")}
                      <span className="text-muted-foreground">
                        {" "}
                        ·{" "}
                        {(job.payload as { group_name?: string } | null)?.group_name ??
                          "no group label"}
                      </span>
                    </p>
                    <p className="label-mono mt-0.5">
                      {relativeTime(job.claimed_at ?? job.created_at)}
                      {job.error ? ` · ${job.error.slice(0, 80)}` : ""}
                    </p>
                  </div>
                  {job.status === "failed" ? (
                    <Button size="sm" variant="ghost" onClick={() => requeue.mutate(job.id)}>
                      Retry
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Recent worker logs" hint="Scans, publishes, session events and faults" />
        {(logs?.length ?? 0) === 0 ? (
          <EmptyState title="No worker logs yet" body="They appear once the VPS starts checking in." />
        ) : (
          <ul className="divide-y divide-border">
            {(logs ?? []).map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-5 py-2.5">
                <StatusDot
                  tone={
                    entry.level === "error"
                      ? "danger"
                      : entry.level === "warning"
                        ? "warning"
                        : entry.level === "success"
                          ? "success"
                          : "neutral"
                  }
                />
                <p className="min-w-0 flex-1 text-sm leading-snug text-foreground/90">
                  {entry.message}
                </p>
                <span className="label-mono shrink-0">
                  {entry.kind} · {relativeTime(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
