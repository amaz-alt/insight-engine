import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Eye, EyeOff, RefreshCw, Terminal } from "lucide-react";
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
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings/worker")({
  head: () => ({
    meta: [
      { title: "Worker Connection & Token — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Copy the app base URL and worker token, regenerate the token, and grab the exact .env file your VPS browser worker needs — no source code or env files to inspect.",
      },
      { property: "og:title", content: "Worker Connection & Token — Facebook Growth OS" },
      {
        property: "og:description",
        content: "Everything the VPS needs to connect, in one copyable block.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkerConfigPage,
});

const PROJECT_ID = "57b17798-8af1-491c-b6db-08c05e52f593";
const STABLE_URL = `https://project--${PROJECT_ID}.lovable.app`;

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setDone(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

function WorkerConfigPage() {
  const queryClient = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(
    typeof window === "undefined" ? STABLE_URL : window.location.origin,
  );

  const { data, isPending } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", true).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const token = newToken();
      const { error } = await supabase
        .from("settings")
        .update({ worker_token: token, session_status: "disconnected" })
        .eq("id", true);
      if (error) throw new Error(error.message);
      return token;
    },
    onSuccess: () => {
      setReveal(true);
      toast.success("New token generated — update the VPS .env and restart the worker");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isPending || !data) return <Loading rows={4} />;

  const token = data.worker_token;
  const masked = `${token.slice(0, 6)}${"•".repeat(24)}${token.slice(-4)}`;
  const envFile = [
    "# Facebook Growth OS — VPS worker",
    `APP_URL=${baseUrl.replace(/\/+$/, "")}`,
    `WORKER_TOKEN=${token}`,
    "",
    "PORT=8787",
    "BIND=127.0.0.1",
    "PROFILE_DIR=./fb-profile",
    "HEADLESS=true",
    "HEARTBEAT_SECONDS=60",
    "POLL_SECONDS=60",
    "LOG_DIR=./logs",
    "LOG_LEVEL=info",
  ].join("\n");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="label-mono">worker connection</p>
        <h1 className="mt-1 text-2xl font-semibold">Connect your VPS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the worker needs is on this page. Copy the block, paste it into{" "}
          <span className="font-mono text-xs">/opt/fb-worker/worker/.env</span>, restart the service.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Credentials"
          hint="Shared token — sent as x-worker-token on every request"
          action={
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
          }
        />
        <div className="space-y-4 p-5">
          <Field
            label="app base url"
            hint="Use the stable URL below for a permanent worker connection"
          >
            <div className="flex gap-2">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-xs" />
              <CopyButton value={baseUrl} />
            </div>
          </Field>

          <div className="flex flex-wrap gap-2 text-xs">
            {[STABLE_URL, typeof window === "undefined" ? STABLE_URL : window.location.origin].map(
              (url) => (
                <button
                  key={url}
                  onClick={() => setBaseUrl(url)}
                  className="rounded-md border border-border bg-secondary/40 px-2 py-1 font-mono text-muted-foreground transition-colors hover:text-foreground"
                >
                  {url}
                </button>
              ),
            )}
          </div>

          <Field label="worker token">
            <div className="flex gap-2">
              <Input readOnly value={reveal ? token : masked} className="font-mono text-xs" />
              <Button variant="ghost" onClick={() => setReveal((v) => !v)}>
                {reveal ? <EyeOff /> : <Eye />} {reveal ? "Hide" : "Show"}
              </Button>
              <CopyButton value={token} />
            </div>
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/40 p-4">
            <div>
              <p className="text-sm font-medium">Regenerate token</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The old token stops working immediately. Update the VPS{" "}
                <span className="font-mono">.env</span> and restart the worker afterwards. Last
                heartbeat {relativeTime(data.last_heartbeat_at)}.
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              <RefreshCw /> {regenerate.isPending ? "Rotating…" : "Regenerate"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="VPS .env"
          hint="Exact file contents — nothing else to configure"
          action={<CopyButton value={envFile} label="Copy .env" />}
        />
        <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-muted-foreground">
          {envFile}
        </pre>
      </Panel>

      <Panel>
        <PanelHeader title="Deploy commands" hint="Fresh Ubuntu VPS, one time" />
        <div className="space-y-3 p-5">
          <pre className="overflow-x-auto rounded-md border border-border bg-secondary/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
            {`cd /opt/fb-worker/worker
nano .env            # paste the block above
sudo bash login.sh   # sign into Facebook once via noVNC
sudo systemctl restart fb-worker
curl -s localhost:8787/health`}
          </pre>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Terminal className="size-3.5" /> The worker checks in within a minute; watch it flip
            online on the Worker Health page.
          </p>
        </div>
      </Panel>
    </div>
  );
}
