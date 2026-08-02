import { createServerFn } from "@tanstack/react-start";

/** One-click health sweep across database, AI, worker, pipeline and safety limits. */
export const runDiagnostics = createServerFn({ method: "POST" }).handler(async () => {
  const { runDiagnostics: run } = await import("./diagnostics.server");
  return run();
});
