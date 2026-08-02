import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge, Button, Field, Input, Loading, Panel, PanelHeader, Select, relativeTime } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Worker & Behaviour — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Connect the VPS browser worker, set the posting window, daily limits and human-like delays for your Facebook automation.",
      },
      { property: "og:title", content: "Worker & Behaviour — Facebook Growth OS" },
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
  min_delay_seconds: number;
  max_delay_seconds: number;
  scan_interval_hours: number;
  timezone: string;
  session_status: string;
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
        min_delay_seconds: data.min_delay_seconds,
        max_delay_seconds: data.max_delay_seconds,
        scan_interval_hours: data.scan_interval_hours,
        timezone: data.timezone,
        session_status: data.session_status,
      });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
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

  if (isPending || !form || !data) return <Loading rows={5} />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const num = (key: keyof Form, label: string, min: number, max: number) => (
    <Field label={label}>
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
          One Facebook account, one VPS worker, low volume on purpose.
        </p>
      </div>

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
              <li>POST /api/public/worker/heartbeat — report session state</li>
              <li>GET&nbsp; /api/public/worker/jobs — claim scan / publish jobs</li>
              <li>POST /api/public/worker/ingest — push scraped discussions</li>
              <li>POST /api/public/worker/complete — report job outcome</li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Send the token as <span className="font-mono">x-worker-token</span>. Keep a persistent Chrome
              profile on the VPS so Facebook login happens once.
            </p>
          </div>

          <Field label="facebook account label">
            <Input
              value={form.fb_account_name}
              onChange={(e) => set("fb_account_name", e.target.value)}
              placeholder="My main account"
            />
          </Field>

          <Field label="session status">
            <Select value={form.session_status} onChange={(e) => set("session_status", e.target.value)}>
              <option value="connected">Connected</option>
              <option value="needs_login">Needs login</option>
              <option value="disconnected">Disconnected</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Human-like behaviour" hint="Low volume beats fast" />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {num("window_start_hour", "posting window start (hour)", 0, 23)}
          {num("window_end_hour", "posting window end (hour)", 1, 23)}
          {num("daily_post_limit", "daily post limit", 1, 30)}
          {num("scan_interval_hours", "scan interval (hours)", 1, 48)}
          {num("min_delay_seconds", "min delay between actions (s)", 30, 3600)}
          {num("max_delay_seconds", "max delay between actions (s)", 60, 7200)}
          <Field label="timezone">
            <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save /> Save settings
          </Button>
        </div>
      </Panel>
    </div>
  );
}
