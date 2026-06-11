import { streamText } from "ai";
import { google } from "@ai-sdk/google";
import { NextRequest } from "next/server";
import { z } from "zod";

import { enforceRouteLimit, jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const completionSchema = z.object({
  prompt: z.string().min(1).max(50000),
});

export async function POST(req: NextRequest) {
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

  const response = await streamText({
    model: google("models/gemini-pro"),
    prompt: `You are an expert technical writer. Please continue this README.md document right from where it leaves off. Output ONLY the raw markdown continuation. Do not include any conversational filler.

Document:
${prompt}
`,
  });

  return response.toTextStreamResponse();
}
