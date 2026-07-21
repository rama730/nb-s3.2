import { z } from "zod";

import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { isLeakedPassword } from "@/lib/security/leaked-password";
import { getPasswordPolicyResult } from "@/lib/security/password-policy";
import { validateCsrf } from "@/lib/security/csrf";

const schema = z.object({ password: z.string().min(1) });

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:password-safety", 10, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request body", 400, "BAD_REQUEST");

  const policy = getPasswordPolicyResult(parsed.data.password);
  if (!policy.ok) return jsonError(policy.error || "Password does not meet security requirements", 400, "BAD_REQUEST");

  try {
    if (await isLeakedPassword(parsed.data.password)) {
      return jsonError(
        "This password has appeared in a data breach. Choose a different password.",
        400,
        "LEAKED_PASSWORD",
      );
    }

    logApiRoute(request, {
      requestId,
      action: "auth.passwordSafety.post",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ safe: true });
  } catch {
    return jsonError(
      "Password safety check is temporarily unavailable. Please try again.",
      503,
      "PASSWORD_SAFETY_UNAVAILABLE",
    );
  }
}
