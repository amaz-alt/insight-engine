import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

const tabs = [
  { to: "/settings", label: "Behaviour & limits" },
  { to: "/settings/worker", label: "Worker connection" },
] as const;

function SettingsLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-border pb-px">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: true }}
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:border-b-2 data-[status=active]:border-primary data-[status=active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
