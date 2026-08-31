import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  enforceRouteLimit,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionRecoverySessions } from "@/lib/db/schema";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const identity = {
  sessionId: z.string().uuid(),
  deviceId: z.string().min(8).max(160),
};

const sessionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    ...identity,
    extensionVersion: z.string().min(1).max(40).optional(),
    previousSessionId: z.string().uuid().optional(),
    previousDisposition: z.enum(["clean", "interrupted"]).optional(),
  }),
  z.object({ action: z.literal("heartbeat"), ...identity }),
  z.object({ action: z.literal("clean"), ...identity }),
]);

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limited = await enforceRouteLimit(request, "api:v1:extension:recovery-sessions:write", 180, 60);
  if (limited) return limited;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user || !auth.extensionSessionId) {
    return auth.response ?? jsonError("An active extension session is required", 401, "UNAUTHORIZED");
  }
  const user = auth.user;
  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid recovery session request", 400, "BAD_REQUEST");

  const now = new Date();
  try {
    const session = await db.transaction(async (tx) => {
      if (parsed.data.action === "start") {
        if (parsed.data.previousSessionId && parsed.data.previousSessionId !== parsed.data.sessionId && parsed.data.previousDisposition) {
          const previous = await tx.query.extensionRecoverySessions.findFirst({
            where: and(
              eq(extensionRecoverySessions.sessionId, parsed.data.previousSessionId),
              eq(extensionRecoverySessions.userId, user.id),
            ),
          });
          const previousStatus = parsed.data.previousDisposition;
          if (!previous) {
            await tx.insert(extensionRecoverySessions).values({
              sessionId: parsed.data.previousSessionId,
              userId: user.id,
              deviceId: parsed.data.deviceId,
              status: previousStatus,
              startedAt: now,
              lastHeartbeatAt: now,
              endedAt: previousStatus === "clean" ? now : null,
              incidentDetectedAt: previousStatus === "interrupted" ? now : null,
              updatedAt: now,
            });
          } else if (previous.status !== "clean" && previous.status !== "resolved") {
            await tx.update(extensionRecoverySessions).set({
              status: previousStatus,
              endedAt: previousStatus === "clean" ? now : previous.endedAt,
              incidentDetectedAt: previousStatus === "interrupted" ? (previous.incidentDetectedAt ?? now) : previous.incidentDetectedAt,
              updatedAt: now,
            }).where(and(
              eq(extensionRecoverySessions.sessionId, previous.sessionId),
              eq(extensionRecoverySessions.userId, user.id),
            ));
          }
        }

        const [started] = await tx.insert(extensionRecoverySessions).values({
          sessionId: parsed.data.sessionId,
          userId: user.id,
          deviceId: parsed.data.deviceId,
          status: "active",
          extensionVersion: parsed.data.extensionVersion,
          startedAt: now,
          lastHeartbeatAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: extensionRecoverySessions.sessionId,
          set: {
            status: "active",
            deviceId: parsed.data.deviceId,
            extensionVersion: parsed.data.extensionVersion,
            lastHeartbeatAt: now,
            endedAt: null,
            updatedAt: now,
          },
        }).returning();
        return started;
      }

      const status = parsed.data.action === "clean" ? "clean" : "active";
      const [updated] = await tx.update(extensionRecoverySessions).set({
        status,
        lastHeartbeatAt: now,
        endedAt: status === "clean" ? now : null,
        updatedAt: now,
      }).where(and(
        eq(extensionRecoverySessions.sessionId, parsed.data.sessionId),
        eq(extensionRecoverySessions.userId, user.id),
        eq(extensionRecoverySessions.deviceId, parsed.data.deviceId),
      )).returning();
      if (updated) return updated;

      const [created] = await tx.insert(extensionRecoverySessions).values({
        sessionId: parsed.data.sessionId,
        userId: user.id,
        deviceId: parsed.data.deviceId,
        status,
        startedAt: now,
        lastHeartbeatAt: now,
        endedAt: status === "clean" ? now : null,
        updatedAt: now,
      }).returning();
      return created;
    });

    recordExtensionMetric("extension.recovery.session", {
      action: parsed.data.action,
      success: true,
      userId: user.id,
    });
    return jsonSuccess({
      sessionId: session?.sessionId,
      status: session?.status,
      lastHeartbeatAt: session?.lastHeartbeatAt?.toISOString(),
    });
  } catch (error) {
    logger.error("extension.recovery.session.failed", {
      action: parsed.data.action,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    recordExtensionMetric("extension.recovery.session", {
      action: parsed.data.action,
      success: false,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Could not update recovery session", 500, "INTERNAL_ERROR");
  }
}
