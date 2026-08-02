import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Metric,
  Panel,
  PanelHeader,
  ProgressBar,
  formatDateTime,
} from "@/components/ui-kit";
import { runDiagnostics } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics — Facebook Growth OS" },
      {
        name: "description",
        content:
          "Run a one-click health sweep across the database, AI gateway, VPS worker, Facebook session, job queue and safety limits.",
      },
      { property: "og:title", content: "Diagnostics — Facebook Growth OS" },
      {
        property: "og:description",
        content: "One click tells you which dependency is broken and how to fix it.",
      },
    ],
  }),
  component: DiagnosticsPage;
});

type Status = "pass" | "warn" | "fail";

const TONE: Record<Status, "success" | "warning" | "danger"> = {
  pass: "success",
  warn: "warning",
  fail: "danger",
};

function StatusIcon({ status }: { status: Status }) {
  if (status === "pass") return <CheckCircle2 className="size-4 text-success" />;
  if (status === "warn") return <AlertTriangle className="size-4 text-warning" />;
  return <XCircle className="size-4 text-destructive" />;
}

function DiagnosticsPage() {
  const run = useServerFn(runDiagnostics);

  const sweep = useMutation({
    mutationFn: async () => run(),
    onSuccess: (result) => {
      const failed = result.checks.filter((c) => c.status === "fail").length;
      if (failed === 0) toast.success("All dependencies responded");
      else toast.error(`${failed} check(s) failing`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const result = sweep.data;
  const checks = result?.checks ?? [];
  const counts = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  const groups = [...new Set(checks.map((c) => c.group))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono">system</p>
          <h1 className="mt-1 text-2xl font-semibold">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {result
              ? `Last sweep ${formatDateTime(result.ranAt)}`
              : "One click checks every dependency the OS depends on."}
          </p>
        </div>
        <Button onClick={() => sweep.mutate()} disabled={sweep.isPending}>
          {sweep.isPending ? <RefreshCw className="animate-spin" /> : <PlayCircle />}
          {sweep.isPending ? "Running checks…" : result ? "Run again" : "Run all checks"}
        </Button>
      </div>

      {sweep.isPending ? <ProgressBar label="Contacting database, AI gateway and worker…" /> : null}

      {sweep.error ? (
        <ErrorState message={sweep.error.message} onRetry={() => sweep.mutate()} />
      ) : null}

      {!result && !sweep.isPending && !sweep.error ? (
        <EmptyState
          title="No sweep yet"
          body="Run the checks to verify the database, AI gateway, VPS worker, Facebook session, queue health and safety limits."
          action={
            <Button onClick={() => sweep.mutate()}>
              <PlayCircle /> Run all checks
            </Button>
          }
        />
      ) : null}

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="checks run" value={checks.length} sub="across every dependency" />
            <Metric label="healthy" value={counts.pass} tone="primary" sub="responding as expected" />
            <Metric label="warnings" value={counts.warn} sub="works, needs attention" />
            <Metric label="failing" value={counts.fail} sub="blocks automation" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => {
              const items = checks.filter((c) => c.group === group);
              const worst: Status = items.some((c) => c.status === "fail")
                ? "fail"
                : items.some((c) => c.status === "warn")
                  ? "warn"
                  : "pass";
              return (
                <Panel key={group}>
                  <PanelHeader
                    title={group}
                    hint={`${items.length} check${items.length === 1 ? "" : "s"}`}
                    actions={<Badge tone={TONE[worst]}>{worst === "pass" ? "healthy" : worst}</Badge>}
                  />
                  <ul className="divide-y divide-border">
                    {items.map((check) => (
                      <li key={check.id} className="flex items-start gap-3 px-5 py-3">
                        <span className="mt-0.5">
                          <StatusIcon status={check.status as Status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{check.label}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
                          {check.hint ? (
                            <p className="mt-1 text-xs text-warning">{check.hint}</p>
                          ) : null}
                        </div>
                        <span className="label-mono shrink-0">{check.ms} ms</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
