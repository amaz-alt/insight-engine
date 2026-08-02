import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { AI_MODEL, createLovableAiGatewayProvider, requireGatewayKey } from "./ai-gateway.server";

const insightSchema = z.object({
  pain_point: z.string(),
  desired_outcome: z.string(),
  objections: z.array(z.string()),
  frustrations: z.array(z.string()),
  topics: z.array(z.string()),
  buying_intent: z.number(),
  urgency: z.number(),
  audience_type: z.string(),
  niche: z.string(),
  sentiment: z.string(),
  confidence: z.number(),
});

const clusterSchema = z.object({
  clusters: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      why_it_matters: z.string(),
      pain_point: z.string(),
      niche: z.string(),
      audience: z.string(),
      demand_score: z.number(),
      buying_intent: z.number(),
      urgency: z.number(),
      confidence: z.number(),
      trend: z.string(),
      keywords: z.array(z.string()),
      post_refs: z.array(z.number()),
      recommended_products: z.array(
        z.object({ name: z.string(), format: z.string(), why: z.string() }),
      ),
    }),
  ),
});

const contentSchema = z.object({
  pieces: z.array(
    z.object({
      kind: z.string(),
      variant_label: z.string(),
      hook: z.string(),
      body: z.string(),
    }),
  ),
});

const clamp = (n: unknown, lo = 0, hi = 100) =>
  Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

async function runStructured<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
): Promise<T | null> {
  const gateway = createLovableAiGatewayProvider(requireGatewayKey());
  try {
    const { output } = await generateText({
      model: gateway(AI_MODEL),
      output: Output.object({ schema }),
      system,
      prompt,
    });
    return output as T;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      try {
        const raw = (error.text ?? "").replace(/```json|```/g, "").trim();
        return schema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    throw error;
  }
}

/** Analyse scraped posts that have no AI insight yet. */
export async function analyzePendingPosts(limit = 12) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: posts, error } = await supabaseAdmin
    .from("posts")
    .select("id, content, author_name, reactions, comments_count, top_comments")
    .is("analyzed_at", null)
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!posts?.length) return { analyzed: 0 };

  let analyzed = 0;
  for (const post of posts) {
    const output = await runStructured(
      insightSchema,
      "You analyse Facebook group discussions to find commercial demand. Be concrete and specific — never generic marketing language. buying_intent, urgency and confidence are integers from 0 to 100. sentiment is one word.",
      `Discussion by ${post.author_name ?? "unknown"} (${post.reactions} reactions, ${post.comments_count} comments):\n\n${post.content}\n\nTop comments: ${JSON.stringify(post.top_comments).slice(0, 2000)}`,
    );
    if (!output) continue;

    await supabaseAdmin.from("post_insights").upsert(
      {
        post_id: post.id,
        pain_point: output.pain_point,
        desired_outcome: output.desired_outcome,
        objections: output.objections.slice(0, 8),
        frustrations: output.frustrations.slice(0, 8),
        topics: output.topics.slice(0, 10),
        buying_intent: clamp(output.buying_intent),
        urgency: clamp(output.urgency),
        audience_type: output.audience_type,
        niche: output.niche,
        sentiment: output.sentiment,
        confidence: clamp(output.confidence),
      },
      { onConflict: "post_id" },
    );
    await supabaseAdmin
      .from("posts")
      .update({ analyzed_at: new Date().toISOString() })
      .eq("id", post.id);
    analyzed += 1;
  }

  if (analyzed) {
    await supabaseAdmin.from("activity_log").insert({
      kind: "insight",
      level: "success",
      message: `AI analysed ${analyzed} new discussion${analyzed === 1 ? "" : "s"}`,
    });
  }

  return { analyzed };
}

/** Cluster recent insights into ranked demand opportunities. */
export async function clusterOpportunities() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("post_insights")
    .select(
      "post_id, pain_point, desired_outcome, objections, frustrations, topics, buying_intent, urgency, niche, audience_type, sentiment",
    )
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);
  if (!rows?.length) return { opportunities: 0 };

  const indexed = rows.map((r, i) => ({ ref: i, ...r }));
  const output = await runStructured(
    clusterSchema,
    "You cluster analysed Facebook discussions into recurring demand groups. Merge discussions describing the same underlying problem. Score demand_score, buying_intent, urgency and confidence as integers 0-100. trend is one of rising, flat or cooling. post_refs contains the ref numbers of the discussions in the cluster. Recommend 2-3 small digital products (templates, planners, workbooks, checklists, swipe files, prompt packs) that directly solve the problem. Return at most 8 clusters, strongest demand first.",
    `Analysed discussions:\n${JSON.stringify(indexed).slice(0, 24000)}`,
  );
  if (!output?.clusters?.length) return { opportunities: 0 };

  await supabaseAdmin.from("opportunities").delete().neq("status", "archived");

  for (const c of output.clusters.slice(0, 8)) {
    const refs = (c.post_refs ?? [])
      .map((ref) => indexed[ref]?.post_id)
      .filter((v): v is string => Boolean(v));

    const { data: inserted } = await supabaseAdmin
      .from("opportunities")
      .insert({
        title: c.title.slice(0, 200),
        summary: c.summary,
        why_it_matters: c.why_it_matters,
        pain_point: c.pain_point,
        niche: c.niche,
        audience: c.audience,
        demand_score: clamp(c.demand_score),
        buying_intent: clamp(c.buying_intent),
        urgency: clamp(c.urgency),
        confidence: clamp(c.confidence),
        frequency: refs.length,
        trend: ["rising", "flat", "cooling"].includes(c.trend) ? c.trend : "flat",
        keywords: (c.keywords ?? []).slice(0, 10),
        recommended_products: (c.recommended_products ?? []).slice(0, 4),
        status: "new",
      })
      .select("id")
      .single();

    if (inserted && refs.length) {
      await supabaseAdmin
        .from("opportunity_posts")
        .upsert(refs.map((post_id) => ({ opportunity_id: inserted.id, post_id })));
    }
  }

  await supabaseAdmin.from("activity_log").insert({
    kind: "insight",
    level: "success",
    message: `AI re-ranked demand into ${output.clusters.length} opportunities`,
  });

  return { opportunities: output.clusters.length };
}

/** Turn one opportunity into publishable content variations. */
export async function generateContentFor(input: {
  opportunityId: string;
  kinds: string[];
  variations: number;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: opp, error } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("id", input.opportunityId)
    .single();
  if (error || !opp) throw new Error("Opportunity not found");

  const { data: sourcePosts } = await supabaseAdmin
    .from("opportunity_posts")
    .select("posts(content)")
    .eq("opportunity_id", input.opportunityId)
    .limit(6);

  const output = await runStructured(
    contentSchema,
    `You write Facebook group posts that sound like a real person talking, not a marketer. No emoji walls, no hashtag spam, no "Are you struggling with...?" openers. Short paragraphs, concrete specifics, one soft call to action at most. kind must be one of: ${input.kinds.join(", ")}. Produce ${input.variations} clearly different variations of each kind, so no two published posts read alike. Keep each body under 1400 characters.`,
    `Opportunity: ${opp.title}
Pain point: ${opp.pain_point}
Audience: ${opp.audience} in ${opp.niche}
Why it matters: ${opp.why_it_matters}
Recommended products: ${JSON.stringify(opp.recommended_products)}

Real discussions behind it:
${(sourcePosts ?? []).map((r) => (r.posts as { content: string } | null)?.content ?? "").join("\n---\n").slice(0, 6000)}`,
  );
  if (!output?.pieces?.length) throw new Error("AI returned no usable content");

  const rows = output.pieces.slice(0, 12).map((p) => ({
    opportunity_id: input.opportunityId,
    kind: input.kinds.includes(p.kind) ? p.kind : (input.kinds[0] ?? "value_post"),
    variant_label: p.variant_label?.slice(0, 60) || "Variation",
    hook: p.hook?.slice(0, 240) ?? null,
    body: p.body.slice(0, 4000),
    status: "draft",
  }));

  const { data: created, error: insertError } = await supabaseAdmin
    .from("content_pieces")
    .insert(rows)
    .select("id");
  if (insertError) throw new Error(insertError.message);

  await supabaseAdmin.from("activity_log").insert({
    kind: "content",
    level: "success",
    message: `Generated ${rows.length} content variations for "${opp.title.slice(0, 60)}"`,
  });

  return { created: created?.length ?? 0 };
}
