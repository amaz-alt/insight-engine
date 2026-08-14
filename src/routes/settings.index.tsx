import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Save, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
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

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
      { title: "Worker Settings & Safety Limits — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Connect the VPS browser worker and cap it: posts per day, scans per hour, delays, randomisation window, quiet hours and groups per cycle.",
      },
      { property: "og:title", content: "Worker Settings & Safety Limits — Facebook Growth OS" },
      {
        property: "og:description",
        content: "One token, one window, one account — nothing else to maintain.",
      },
    ],
  }),
  component: SettingsPage,
});

type Form = {
  fb_account_name: string;
  window_start_hour: number;
  window_end_hour: number;
  daily_post_limit: number;
  scans_per_hour: number;
  max_groups_per_cycle: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  randomization_window_minutes: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  scan_interval_hours: number;
  job_lease_minutes: number;
  max_job_attempts: number;
  allow_repost_same_content: boolean;
  timezone: string;

};

function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", true).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        fb_account_name: data.fb_account_name ?? "",
        window_start_hour: data.window_start_hour,
        window_end_hour: data.window_end_hour,
        daily_post_limit: data.daily_post_limit,
        scans_per_hour: data.scans_per_hour,
        max_groups_per_cycle: data.max_groups_per_cycle,
        min_delay_seconds: data.min_delay_seconds,
        max_delay_seconds: data.max_delay_seconds,
        randomization_window_minutes: data.randomization_window_minutes,
        quiet_hours_start: data.quiet_hours_start,
        quiet_hours_end: data.quiet_hours_end,
        scan_interval_hours: data.scan_interval_hours,
        timezone: data.timezone,
        session_status: data.session_status,
      });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (form.min_delay_seconds > form.max_delay_seconds)
        throw new Error("Minimum delay cannot be larger than the maximum delay");
      const { error } = await supabase
        .from("settings")
        .update({ ...form, fb_account_name: form.fb_account_name || null })
        .eq("id", true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Worker behaviour saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setAutoPublish = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.from("settings").update({ auto_publish: next }).eq("id", true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Review mode updated");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isPending || !form || !data) return <Loading rows={5} />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const num = (key: keyof Form, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Input
        type="number"
        min={min}
        max={max}
        value={String(form[key])}
        onChange={(e) => set(key, Number(e.target.value) as never)}
      />
    </Field>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="label-mono">configuration</p>
        <h1 className="mt-1 text-2xl font-semibold">Worker &amp; behaviour</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One Facebook account, one VPS worker, low volume on purpose.{" "}
          <Link to="/worker" className="text-primary">
            Live health →
          </Link>
        </p>
      </div>

      <Panel>
        <PanelHeader title="Review mode" hint="Nothing reaches Facebook without your say-so" />
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium">Auto publish</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Off by default. While it's off, any scheduled post whose content is still a draft is
              held back and flagged for approval instead of published.
            </p>
          </div>
          <Toggle
            checked={data.auto_publish}
            label="Auto publish"
            onChange={(next) => setAutoPublish.mutate(next)}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Browser worker" hint="Your VPS authenticates with this token" />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              tone={
                data.session_status === "connected"
                  ? "success"
                  : data.session_status === "needs_login"
                    ? "warning"
                    : "neutral"
              }
            >
              {data.session_status.replace(/_/g, " ")}
            </Badge>
            <span className="text-xs text-muted-foreground">
              last heartbeat {relativeTime(data.last_heartbeat_at)}
            </span>
          </div>

          <Field label="worker token">
            <div className="flex gap-2">
              <Input readOnly value={data.worker_token} className="font-mono text-xs" />
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(data.worker_token);
                  toast.success("Token copied");
                }}
              >
                <Copy /> Copy
              </Button>
            </div>
          </Field>

          <div className="rounded-md border border-border bg-secondary/40 p-4">
            <p className="label-mono">worker endpoints</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
              <li>POST /api/public/worker/heartbeat — session state + commands</li>
              <li>POST /api/public/worker/jobs — claim scan / publish jobs</li>
              <li>POST /api/public/worker/ingest — push scraped discussions</li>
              <li>POST /api/public/worker/complete — report job outcome</li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Send the token as <span className="font-mono">x-worker-token</span>. Keep a persistent
              Chrome profile on the VPS so Facebook login happens once. Credentials stay on the VPS —
              this app never sees them.
            </p>
          </div>

          <Field label="facebook account label">
            <Input
              value={form.fb_account_name}
              onChange={(e) => set("fb_account_name", e.target.value)}
              placeholder="My main account"
            />
          </Field>

          <Field label="session status" hint="Override only if the worker got stuck reporting">
            <Select value={form.session_status} onChange={(e) => set("session_status", e.target.value)}>
              <option value="connected">Connected</option>
              <option value="needs_login">Needs login</option>
              <option value="disconnected">Disconnected</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Safety limits"
          hint="Hard caps the worker cannot exceed"
          action={
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <ShieldAlert className="size-3.5" /> low volume on purpose
            </span>
          }
        />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {num("daily_post_limit", "max posts per day", 1, 30)}
          {num("scans_per_hour", "max scans per hour", 1, 30)}
          {num("max_groups_per_cycle", "max groups scanned per cycle", 1, 20)}
          {num("scan_interval_hours", "rescan a group every (hours)", 1, 48)}
          {num("min_delay_seconds", "min delay between actions (s)", 30, 3600)}
          {num("max_delay_seconds", "max delay between actions (s)", 60, 7200)}
          {num(
            "randomization_window_minutes",
            "randomisation window (min)",
            5,
            180,
            "How far a scheduled time can drift so posts never land on the clock",
          )}
          {num("window_start_hour", "posting window start (hour)", 0, 23)}
          {num("window_end_hour", "posting window end (hour)", 1, 23)}
          {num("quiet_hours_start", "quiet hours start (hour)", 0, 23, "No publishing at all during quiet hours")}
          {num("quiet_hours_end", "quiet hours end (hour)", 0, 23)}
          <Field label="timezone">
            <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save /> {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
