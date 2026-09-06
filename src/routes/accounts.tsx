import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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
  StatusDot,
  Toggle,
  formatDateTime,
  relativeTime,
} from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/accounts")({
  head: () => ({
    meta: [
      { title: "Facebook Accounts — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Run several Facebook accounts from one server. Add an account, sign in once, assign its groups and watch its session health — no extra machine required.",
      },
      { property: "og:title", content: "Facebook Accounts — Facebook Growth OS" },
      {
        property: "og:description",
        content: "One server, one isolated browser profile per Facebook account.",
      },
    ],
  }),
  component: AccountsPage,
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "account";

const ONLINE_WINDOW_MS = 10 * 60_000;

function AccountsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [clientLabel, setClientLabel] = useState("");

  const { data: accounts, isPending } = useQuery({
    queryKey: ["accounts"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: groupCounts } = useQuery({
    queryKey: ["accounts-group-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("groups").select("account_id");
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.account_id) continue;
        counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const invalidate = () => queryClient.invalidateQueries();

  const addAccount = useMutation({
    mutationFn: async () => {
      const label = name.trim();
      if (!label) throw new Error("Give the account a name you'll recognise");
      const taken = new Set((accounts ?? []).map((a) => a.profile_dir));
      let profile = slugify(label);
      let n = 2;
      while (taken.has(profile)) profile = `${slugify(label)}-${n++}`;

      const { error } = await supabase.from("accounts").insert({
        name: label,
        profile_dir: profile,
        client_label: clientLabel.trim() || null,
      });
      if (error) throw new Error(error.message);
      return profile;
    },
    onSuccess: (profile) => {
      setName("");
      setClientLabel("");
      toast.success(`Account added — sign it in once using profile "${profile}"`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, unknown> }) => {
      const { error } = await supabase.from("accounts").update(values).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const command = useMutation({
    mutationFn: async ({ id, cmd }: { id: string; cmd: string }) => {
      const { error } = await supabase
        .from("accounts")
        .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Queued — the server picks it up within a minute");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Account removed — its groups are now unassigned");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">accounts</p>
        <h1 className="mt-1 text-2xl font-semibold">Facebook accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One server runs every account side by side, each in its own separate browser with its own
          login. Add an account here, sign it in once, then assign its groups.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Add an account"
          hint="Your second account, or a client's — no new server needed"
        />
        <div className="grid gap-3 p-5 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
          <Field label="account name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My main account"
            />
          </Field>
          <Field label="client (optional)">
            <Input
              value={clientLabel}
              onChange={(e) => setClientLabel(e.target.value)}
              placeholder="Acme Coaching"
            />
          </Field>
          <Button variant="primary" onClick={() => addAccount.mutate()} disabled={addAccount.isPending}>
            <Plus /> Add account
          </Button>
        </div>
      </Panel>

      {isPending ? (
        <Loading rows={4} />
      ) : (accounts?.length ?? 0) === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Add your first Facebook account above, then sign it in once on the server."
        />
      ) : (
        <div className="space-y-4">
          {(accounts ?? []).map((account) => {
            const online =
              account.last_heartbeat_at &&
              Date.now() - new Date(account.last_heartbeat_at).getTime() < ONLINE_WINDOW_MS;
            const loginCommand = `cd ~/fb-worker && LOGIN_PROFILE=${account.profile_dir} bash login.sh`;

            return (
              <Panel key={account.id}>
                <PanelHeader
                  title={account.name}
                  hint={
                    account.client_label
                      ? `client: ${account.client_label}`
                      : "your own account"
                  }
                  action={
                    <div className="flex items-center gap-3">
                      <span className="label-mono">active</span>
                      <Toggle
                        checked={account.enabled}
                        label="Account active"
                        onChange={(next) =>
                          patch.mutate({ id: account.id, values: { enabled: next } })
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove account"
                        onClick={() => remove.mutate(account.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  }
                />

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-5 py-3">
                  <span className="flex items-center gap-2 text-sm">
                    <StatusDot
                      tone={
                        !account.enabled
                          ? "neutral"
                          : account.session_status === "connected"
                            ? "success"
                            : account.session_status === "needs_login"
                              ? "warning"
                              : "danger"
                      }
                    />
                    {!account.enabled
                      ? "paused"
                      : account.session_status === "connected"
                        ? "signed in"
                        : account.session_status === "needs_login"
                          ? "signed out — needs the one-time login"
                          : "not reachable yet"}
                  </span>
                  <Badge tone={online ? "success" : "neutral"}>
                    {online ? "server checking in" : "no check-in"}
                  </Badge>
                  <span className="label-mono">
                    {groupCounts?.get(account.id) ?? 0} groups · browser {account.chrome_status}
                  </span>
                </div>

                <dl className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-2">
                  {[
                    ["last check-in", relativeTime(account.last_heartbeat_at)],
                    ["login last confirmed", formatDateTime(account.session_validated_at)],
                    [
                      "login expires",
                      account.session_expires_at
                        ? formatDateTime(account.session_expires_at)
                        : "not detectable",
                    ],
                    ["last scan", formatDateTime(account.last_scan_at)],
                    ["last post published", formatDateTime(account.last_publish_at)],
                    ["browser profile", account.profile_dir],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-center justify-between gap-4">
                      <dt className="label-mono">{label}</dt>
                      <dd className="text-sm text-foreground/90">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
                  <Button
                    onClick={() => command.mutate({ id: account.id, cmd: "validate_session" })}
                    disabled={command.isPending}
                  >
                    <ShieldCheck /> Check the login
                  </Button>
                  <Button
                    onClick={() => command.mutate({ id: account.id, cmd: "reconnect" })}
                    disabled={command.isPending}
                  >
                    <RefreshCw /> Restart its browser
                  </Button>
                  <Button variant="ghost" onClick={() => copy(loginCommand)}>
                    <Copy /> Copy its sign-in command
                  </Button>
                </div>

                {account.needs_login ? (
                  <div className="border-t border-warning/40 bg-warning/5 px-5 py-4">
                    <p className="flex items-center gap-2 text-sm text-warning">
                      <KeyRound className="size-4 shrink-0" />
                      This account needs its one-time Facebook sign-in. On your server, run:
                    </p>
                    <code className="mt-2 block overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-xs">
                      {loginCommand}
                    </code>
                    <p className="mt-2 text-xs text-muted-foreground">
                      It opens a browser window you can view in your own browser at the address it
                      prints. Sign in once — it stays signed in from then on.
                    </p>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Every account is kept completely separate: its own browser, its own login, its own groups.
          Nothing is shared between them, and passwords are never stored here — only on your own
          server, inside the browser itself.
        </p>
      </Panel>
    </div>
  );
}
