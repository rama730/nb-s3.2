import { z } from "zod";

import { jsonError } from "@/app/api/v1/_envelope";
import { enforceRouteLimit, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { FileLeaseConflictError, FileLeaseLostError } from "@/lib/files/file-lock-service";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";

export const leaseCredentialsSchema = z.object({
  sessionId: z.string().uuid(),
  leaseId: z.string().uuid(),
  fencingToken: z.number().int().positive(),
});

export const leaseTtlSecondsSchema = z.number().int().min(30).max(180);
export const leaseTtlMsSchema = z.number().int().min(30_000).max(180_000);

export async function requireFileLeaseUser(
  request: Request,
  options: {
    csrf?: boolean;
    extensionSession?: boolean;
    rateLimit?: { key: string; limit: number; windowSeconds: number };
  } = {},
) {
  if (options.csrf) {
    const csrfError = validateCsrf(request);
    if (csrfError) return { response: csrfError, user: null, extensionSessionId: null };
  }

  if (options.rateLimit) {
    const limited = await enforceRouteLimit(
      request,
      options.rateLimit.key,
      options.rateLimit.limit,
      options.rateLimit.windowSeconds,
    );
    if (limited) return { response: limited, user: null, extensionSessionId: null };
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return {
      response: auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED"),
      user: null,
      extensionSessionId: null,
    };
  }
  if (options.extensionSession && !auth.extensionSessionId) {
    return {
      response: jsonError("An active extension device session is required", 401, "UNAUTHORIZED"),
      user: null,
      extensionSessionId: null,
    };
  }

  return { response: null, user: auth.user, extensionSessionId: auth.extensionSessionId };
}

export async function parseFileLeaseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
  message: string,
): Promise<{ data: z.infer<T>; response: null } | { data: null; response: ReturnType<typeof jsonError> }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { data: null, response: jsonError(message, 400, "BAD_REQUEST") };
  return { data: parsed.data, response: null };
}

export function ttlMsToSeconds(ttlMs: number | undefined) {
  return ttlMs ? Math.round(ttlMs / 1_000) : undefined;
}

export function fileLeaseErrorResponse(
  error: unknown,
  fallbackMessage: string,
  logContext?: { route: string },
) {
  if (error instanceof FileLeaseConflictError) {
    return jsonError(error.message, 423, "FILE_LOCKED", { lock: error.lock });
  }
  if (error instanceof FileLeaseLostError) {
    return jsonError(error.message, 409, "CONFLICT");
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message === "File not found") return jsonError(message, 404, "NOT_FOUND");
  if (logContext) {
    logger.error(`${logContext.route} lease operation failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return jsonError(message, 500, "INTERNAL_ERROR");
}
