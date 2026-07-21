"use server";

import { db } from "@/lib/db";
import { extensionDeviceSessions, extensionDeviceSessionEvents } from "@/lib/db/schema";
import { withDbRetry } from "@/lib/db/retry";
import { getTrustedHeadersIp } from "@/lib/security/request-ip";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { issueExtensionAuthCode } from "@/lib/extension/auth-code";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { listActiveExtensionSessionsForUser } from "@/lib/extension/active-sessions";
import { buildExtensionRevocationUri, inferExtensionCallbackUri, normalizeExtensionCallbackUri } from "@/lib/extension/session-callback";
import { z } from "zod";

type ExtensionTokenAuthMethod = "web_login" | "manual_token";

type GenerateExtensionTokenOptions = {
    authMethod?: ExtensionTokenAuthMethod;
    clientVersion?: string;
    editorHost?: string;
    editorName?: string;
    editorPlatform?: string;
    editorVersion?: string;
    requestState?: string | null;
    callbackUri?: string | null;
};

const extensionSessionIdSchema = z.string().uuid();

function normalizeSessionMetadata(value: unknown, maxLength = 120) {
    if (typeof value !== "string") return null;
    const normalized = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeDeviceName(deviceName: string, authMethod: ExtensionTokenAuthMethod) {
    const trimmed = deviceName.trim();
    if (trimmed) return trimmed.slice(0, 120);
    return authMethod === "web_login" ? "Editor extension" : "Manual token";
}

export async function getActiveExtensionSessions(
    options: { limit?: number; cursor?: string | null } = {},
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const page = await listActiveExtensionSessionsForUser(user.id, options);

        return {
            success: true as const,
            sessions: page.sessions,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
        };
    } catch (e) {
        console.error("Failed to fetch extension sessions:", e);
        return { success: false as const, error: "Failed to fetch active extension sessions" };
    }
}

export async function revokeExtensionSession(sessionId: string) {
    try {
        if (!extensionSessionIdSchema.safeParse(sessionId).success) {
            return { success: false as const, error: "Invalid editor session" };
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const session = await db.query.extensionDeviceSessions.findFirst({
            where: and(
                eq(extensionDeviceSessions.id, sessionId),
                eq(extensionDeviceSessions.userId, user.id)
            ),
        });

        if (!session) {
            return { success: false as const, error: "Session not found" };
        }

        const now = new Date();
        const headerStore = await headers();
        const revoked = await withDbRetry("extension.revoke_session", () => db.transaction(async (tx) => {
            const [updated] = await tx
                .update(extensionDeviceSessions)
                .set({
                    revokedAt: now,
                    revocationReason: "user_settings_disconnect",
                })
                .where(and(
                    eq(extensionDeviceSessions.id, sessionId),
                    eq(extensionDeviceSessions.userId, user.id),
                    isNull(extensionDeviceSessions.revokedAt),
                ))
                .returning({ id: extensionDeviceSessions.id });

            if (!updated) return false;

            await tx.insert(extensionDeviceSessionEvents).values({
                sessionId,
                eventType: EXTENSION_DEVICE_SESSION_EVENTS.revocation,
                ipAddress: getTrustedHeadersIp(headerStore),
                userAgent: headerStore.get("user-agent")?.trim() || null,
                metadata: { reason: "user_settings_disconnect" },
                createdAt: now,
            });
            return true;
        }), { module: "extension" });

        return {
            success: true as const,
            alreadyRevoked: !revoked,
            disconnectUri: buildExtensionRevocationUri(
                session.callbackUri ?? inferExtensionCallbackUri(session.editorHost, session.editorName),
                session.id,
            ),
        };
    } catch (e) {
        console.error("Failed to revoke extension session:", e);
        return { success: false as const, error: "Failed to revoke extension session" };
    }
}

export async function generateExtensionToken(
    deviceName: string,
    options: GenerateExtensionTokenOptions = {},
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const authMethod = options.authMethod ?? "manual_token";
        const headerStore = await headers();
        const ipAddress = getTrustedHeadersIp(headerStore);
        const userAgent = headerStore.get("user-agent")?.trim() || null;
        const editorHost = normalizeSessionMetadata(options.editorHost, 80);
        const editorName = normalizeSessionMetadata(options.editorName, 120);
        const editorPlatform = normalizeSessionMetadata(options.editorPlatform, 80);
        const editorVersion = normalizeSessionMetadata(options.editorVersion, 80);
        const callbackUri = normalizeExtensionCallbackUri(options.callbackUri);

        // Generate token and hash
        const rawToken = "nb_dev_" + crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const tokenPrefix = rawToken.slice(0, 11); // "nb_dev_" + 4 characters

        // Token expires in 1 year
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        const createdAt = new Date();
        const session = await withDbRetry("extension.generate_token", async () => {
            return db.transaction(async (tx) => {
                const insertedSessions = await tx
                    .insert(extensionDeviceSessions)
                    .values({
                        userId: user.id,
                        tokenHash,
                        tokenPrefix,
                        deviceName: normalizeDeviceName(deviceName, authMethod),
                        clientVersion: options.clientVersion?.trim().slice(0, 40) || "pending",
                        ipAddress,
                        userAgent,
                        editorHost,
                        editorName,
                        editorPlatform,
                        editorVersion,
                        callbackUri,
                        expiresAt,
                        createdAt,
                        lastSeenAt: createdAt,
                    })
                    .onConflictDoNothing({ target: extensionDeviceSessions.tokenHash })
                    .returning();

                const session = insertedSessions[0] ?? (await tx
                    .select()
                    .from(extensionDeviceSessions)
                    .where(eq(extensionDeviceSessions.tokenHash, tokenHash))
                    .limit(1))[0];

                if (!session) {
                    throw new Error("Failed to insert extension session");
                }

                await tx.insert(extensionDeviceSessionEvents).values({
                    sessionId: session.id,
                    eventType: EXTENSION_DEVICE_SESSION_EVENTS.login,
                    ipAddress,
                    userAgent,
                    metadata: {
                        method: authMethod,
                        editorHost,
                        editorName,
                        editorPlatform,
                        editorVersion,
                    },
                    createdAt,
                });

                return session;
            });
        }, { module: "extension" });

        return { success: true as const, rawToken, session };
    } catch (e) {
        console.error("Failed to generate extension token:", e);
        return { success: false as const, error: "Failed to generate extension token" };
    }
}

export async function generateExtensionAuthCode(
    deviceName: string,
    options: GenerateExtensionTokenOptions = {},
) {
    const callbackUri = normalizeExtensionCallbackUri(options.callbackUri);
    const requestState = typeof options.requestState === "string" ? options.requestState : "";
    if (!callbackUri || !requestState || requestState.length > 256) {
        return { success: false as const, error: "Invalid editor authorization request" };
    }

    const requestStateHash = crypto.createHash("sha256").update(requestState).digest("hex");
    const result = await generateExtensionToken(deviceName, {
        ...options,
        callbackUri,
        authMethod: options.authMethod ?? "web_login",
    });

    if (!result.success) {
        return result;
    }

    try {
        const headerStore = await headers();
        const issued = issueExtensionAuthCode({
            rawToken: result.rawToken,
            sessionId: result.session.id,
            userId: result.session.userId,
        });

        await withDbRetry("extension.auth_code.issue_event", async () => {
            await db.insert(extensionDeviceSessionEvents).values({
                sessionId: result.session.id,
                eventType: EXTENSION_DEVICE_SESSION_EVENTS.authCodeIssued,
                ipAddress: getTrustedHeadersIp(headerStore),
                userAgent: headerStore.get("user-agent")?.trim() || null,
                metadata: {
                    codeHash: issued.codeHash,
                    codeId: issued.codeId,
                    expiresAt: issued.expiresAt.toISOString(),
                    requestStateHash,
                },
                createdAt: new Date(),
            });
        }, { module: "extension" });

        return {
            success: true as const,
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
            session: result.session,
        };
    } catch (error) {
        console.error("Failed to generate extension auth code:", error);
        return { success: false as const, error: "Failed to generate extension authorization code" };
    }
}
