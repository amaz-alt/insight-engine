import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * AI provider: Google AI Studio (Gemini) via its OpenAI-compatible endpoint,
 * using the project's own GEMINI_API_KEY. No Lovable credits are consumed.
 */
export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey,
  });
}

export function requireGatewayKey() {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) {
    throw new Error(
      "AI is not configured yet — add a GEMINI_API_KEY (Google AI Studio) in project settings.",
    );
  }
  return key;
}

/** Cheapest capable Gemini model; swap to gemini-2.5-flash for higher quality. */
export const AI_MODEL = "gemini-2.5-flash-lite";
