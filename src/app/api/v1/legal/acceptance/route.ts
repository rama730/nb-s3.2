import { z } from "zod";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { getLegalAcceptanceState, recordCurrentLegalAcceptance } from "@/lib/legal/acceptance";
import { validateCsrf } from "@/lib/security/csrf";

const acceptanceSchema = z.object({
  accepted: z.literal(true),
  context: z.enum(["oauth_signup", "settings", "material_update"]),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  return jsonSuccess(await getLegalAcceptanceState(auth.user.id));
}
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  const parsed = acceptanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Explicit acceptance is required", 400, "BAD_REQUEST");
  await recordCurrentLegalAcceptance({ userId: auth.user.id, request, context: parsed.data.context });
  return jsonSuccess({ accepted: true, requestId: getRequestId(request) });
}
