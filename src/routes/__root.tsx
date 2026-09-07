import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import {
  Activity,
  BrainCircuit,
  CalendarClock,
  HeartPulse,
  LayoutDashboard,
  Library,
  PenLine,
  Settings2,
  Stethoscope,
  UserCog,
  Users,

} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Badge, relativeTime } from "@/components/ui-kit";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="label-mono">404</p>
        <h1 className="mt-3 font-display text-2xl font-semibold">This console screen is missing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for isn't part of the OS.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="label-mono text-destructive">system fault</p>
        <h1 className="mt-3 font-display text-xl font-semibold">This screen didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Facebook Growth OS" },
      {
        name: "description",
        content:
          "A personal operating system for finding demand in Facebook Groups, turning it into content, and publishing it on a human schedule.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Accounts", icon: UserCog },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/insights", label: "Demand", icon: BrainCircuit },
  { to: "/content", label: "Content", icon: PenLine },
  { to: "/schedule", label: "Schedule", icon: CalendarClock },
  { to: "/knowledge", label: "Knowledge", icon: Library },
  { to: "/worker", label: "Worker", icon: HeartPulse },
  { to: "/diagnostics", label: "Diagnostics", icon: Stethoscope },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

const ONLINE_WINDOW_MS = 10 * 60_000;

function useWorkerPulse() {
  return useQuery({
    queryKey: ["session-status"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [settings, accounts] = await Promise.all([
        supabase
          .from("settings")
          .select("session_status, last_heartbeat_at, fb_account_name")
          .eq("id", true)
          .maybeSingle(),
        supabase.from("accounts").select("id, name, session_status, needs_login, enabled"),
      ]);
      const last = settings.data?.last_heartbeat_at ?? null;
      return {
        status: settings.data?.session_status ?? "disconnected",
        lastHeartbeatAt: last,
        accountName: settings.data?.fb_account_name ?? null,
        online: last ? Date.now() - new Date(last).getTime() < ONLINE_WINDOW_MS : false,
        signedOut: (accounts.data ?? []).filter((a) => a.enabled && a.needs_login),
      };
    },
  });
}

function OfflineBanner() {
  const { data } = useWorkerPulse();
  if (!data) return null;

  if (!data.online) {
    return (
      <div className="border-b border-destructive/50 bg-destructive/10 px-5 py-3">
        <p className="text-sm font-semibold text-destructive">
          Your helper on the server has stopped — nothing is being collected or posted right now.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Last check-in {relativeTime(data.lastHeartbeatAt)}. Start it again on your server, then
          this warning disappears within a minute.{" "}
          <Link to="/worker" className="underline">
            See what to do
          </Link>
        </p>
      </div>
    );
  }

  if (data.signedOut.length > 0) {
    return (
      <div className="border-b border-warning/50 bg-warning/10 px-5 py-3">
        <p className="text-sm font-semibold text-warning">
          {data.signedOut.map((a) => a.name).join(", ")}{" "}
          {data.signedOut.length === 1 ? "is" : "are"} signed out of Facebook — that account is
          paused until you sign in once.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <Link to="/accounts" className="underline">
            Open Accounts
          </Link>{" "}
          for the one-line sign-in command.
        </p>
      </div>
    );
  }

  return null;
}

function SessionPill() {
  const { data } = useWorkerPulse();
  const status = data?.status ?? "disconnected";
  const offline = data ? !data.online : false;
  const tone = offline
    ? "danger"
    : status === "connected"
      ? "success"
      : status === "needs_login"
        ? "warning"
        : "neutral";

  return (
    <div className="flex items-center gap-2">
      <Badge tone={tone}>
        <Activity className="size-3" />
        {offline ? "worker offline" : status === "connected" ? "worker live" : status.replace("_", " ")}
      </Badge>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {data?.accountName ? `${data.accountName} · ` : ""}
        {relativeTime(data?.lastHeartbeatAt)}
      </span>
    </div>
  );
}


function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px]">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border px-3 py-5 lg:flex">
        <Link to="/" className="mb-7 flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            fb
          </span>
          <span className="leading-tight">
            <span className="block font-display text-sm font-semibold">Growth OS</span>
            <span className="label-mono">insight engine</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{
                className:
                  "bg-secondary text-foreground font-medium border-l-2 border-primary rounded-l-none",
              }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>

        <p className="px-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Five minutes a day. The worker handles the rest.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-5 py-3 backdrop-blur">
          <nav className="flex gap-1 overflow-x-auto lg:hidden">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-muted-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                {label}
              </Link>
            ))}
          </nav>
          <span className="hidden lg:block label-mono">facebook growth &amp; insight os</span>
          <SessionPill />
        </header>

        <OfflineBanner />

        <main className="min-w-0 flex-1 px-5 py-6">{children}</main>

      </div>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Shell>
        {/* Required: nested routes render here. */}
        <Outlet />
      </Shell>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
