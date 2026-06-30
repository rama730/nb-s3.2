import { streamText } from "ai";
import { google } from "@ai-sdk/google";
import { NextRequest } from "next/server";
import { z } from "zod";

import { enforceRouteLimit, jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const completionSchema = z.object({
  prompt: z.string().min(1).max(20000),
});

const COMPLETION_TIMEOUT_MS = 30_000;
const COMPLETION_HOURLY_CREDITS = 200;
const PROMPT_CHARS_PER_CREDIT = 1_000;

export async function POST(req: NextRequest) {
  const csrfResponse = validateCsrf(req);
  if (csrfResponse) return csrfResponse;

  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user || authResponse) {
    return authResponse || jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const limitResponse = await enforceRouteLimit(req, `api:v1:completion:${user.id}`, 20, 60);
  if (limitResponse) return limitResponse;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, "BAD_REQUEST");
  }

  const parseResult = completionSchema.safeParse(body);
  if (!parseResult.success) {
    return jsonError("Invalid request body", 400, "BAD_REQUEST");
  }

  const { prompt } = parseResult.data;
  const promptCost = Math.max(1, Math.ceil(prompt.length / PROMPT_CHARS_PER_CREDIT));
  const budget = await consumeRateLimit(
    `api:v1:completion:budget:${user.id}`,
    COMPLETION_HOURLY_CREDITS,
    60 * 60,
    {
      scope: "api:v1:completion:",
      failMode: "fail_closed",
      cost: promptCost,
    },
  );
  if (!budget.allowed) {
    return jsonError("Hourly completion budget exceeded", 429, "RATE_LIMITED");
  }

  try {
    const response = streamText({
      model: google("models/gemini-pro"),
      prompt: `You are an expert technical writer. Please continue this README.md document right from where it leaves off. Output ONLY the raw markdown continuation. Do not include any conversational filler.

Document:
${prompt}
`,
      abortSignal: req.signal,
      timeout: { totalMs: COMPLETION_TIMEOUT_MS, chunkMs: 10_000 },
      maxOutputTokens: 2_000,
      maxRetries: 1,
      temperature: 0.2,
      onFinish: ({ usage }) => {
        logger.metric("ai.completion.usage", {
          module: "completion",
          userId: user.id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          promptCredits: promptCost,
        });
      },
      onError: ({ error }) => {
        logger.error("ai.completion.stream_failed", {
          module: "completion",
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    return response.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
        "X-Completion-Budget-Remaining": String(budget.remaining),
      },
    });
  } catch (error) {
    logger.error("ai.completion.request_failed", {
      module: "completion",
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Completion service unavailable", 503, "UNAVAILABLE");
  }
}
