import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Analyse every scraped discussion that has no AI reading yet. */
export const analyzeNewPosts = createServerFn({ method: "POST" }).handler(async () => {
  const { analyzePendingPosts } = await import("./ai.server");
  return analyzePendingPosts();
});

/** Re-cluster insights into ranked demand opportunities. */
export const rebuildOpportunities = createServerFn({ method: "POST" }).handler(async () => {
  const { clusterOpportunities } = await import("./ai.server");
  return clusterOpportunities();
});

/** Turn one opportunity into publishable content variations. */
export const generateContent = createServerFn({ method: "POST" })
  .inputValidator((input: { opportunityId: string; kinds?: string[]; variations?: number }) => ({
    opportunityId: z.string().uuid().parse(input.opportunityId),
    kinds: (input.kinds ?? ["value_post", "story_post", "engagement_post"]).slice(0, 6),
    variations: Math.max(1, Math.min(3, input.variations ?? 2)),
  }))
  .handler(async ({ data }) => {
    const { generateContentFor } = await import("./ai.server");
    return generateContentFor(data);
  });
