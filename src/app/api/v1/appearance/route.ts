import {
    enforceRouteLimit,
    getRequestId,
    jsonError,
    jsonSuccess,
    logApiRoute,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import {
    createAppearanceSnapshot,
    DEFAULT_APPEARANCE_SNAPSHOT,
    parseAppearanceSnapshot,
    type AppearanceSnapshot,
} from "@/lib/theme/appearance";

const parsedAppearanceSyncTimeoutMs = Number(process.env.AUTH_MIDDLEWARE_LOOKUP_TIMEOUT_MS);
const APPEARANCE_SYNC_TIMEOUT_MS = Math.max(
    1_000,
    Number.isFinite(parsedAppearanceSyncTimeoutMs) ? parsedAppearanceSyncTimeoutMs : 4_000,
);

function readUserMetadata(user: { user_metadata?: unknown }) {
    return user.user_metadata && typeof user.user_metadata === "object"
        ? (user.user_metadata as Record<string, unknown>)
        : {};
}

function readAppearanceSnapshotFromMetadata(user: { user_metadata?: unknown }): AppearanceSnapshot | null {
    const metadata = readUserMetadata(user);
    return parseAppearanceSnapshot(metadata.app_appearance);
}

async function withAppearanceTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`${label} timed out`));
                }, APPEARANCE_SYNC_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function GET(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const limitResponse = await enforceRouteLimit(request, "api:v1:appearance:get", 120, 60);
    if (limitResponse) {
        return limitResponse;
    }

    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
        return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    try {
        const snapshot = readAppearanceSnapshotFromMetadata(auth.user);
        logApiRoute(request, {
            requestId,
            action: "appearance.get",
            userId: auth.user.id,
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess({
            userId: auth.user.id,
            snapshot,
        });
    } catch (error) {
        console.error("[api/v1/appearance] failed to load settings", error);
        logApiRoute(request, {
            requestId,
            action: "appearance.get",
            userId: auth.user.id,
            startedAt,
            success: false,
            status: 500,
            errorCode: "INTERNAL_ERROR",
        });
        return jsonError("Failed to load appearance settings", 500, "INTERNAL_ERROR");
    }
}

export async function PUT(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const limitResponse = await enforceRouteLimit(request, "api:v1:appearance:put", 60, 60);
    if (limitResponse) {
        return limitResponse;
    }

    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
        return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    try {
        const body = (await request.json().catch(() => null)) as { snapshot?: unknown } | null;
        const snapshot = parseAppearanceSnapshot(body?.snapshot);
        if (!snapshot) {
            return jsonError("Invalid appearance snapshot", 400, "BAD_REQUEST");
        }

        const metadata = readUserMetadata(auth.user);
        const updateResult = await withAppearanceTimeout(
            auth.supabase.auth.updateUser({
                data: {
                    ...metadata,
                    app_appearance: snapshot,
                },
            }),
            "Appearance update",
        );

        if (updateResult.error) {
            console.error("[api/v1/appearance] update failed", updateResult.error);
            logApiRoute(request, {
                requestId,
                action: "appearance.put",
                userId: auth.user.id,
                startedAt,
                success: false,
                status: 500,
                errorCode: "INTERNAL_ERROR",
            });
            return jsonError(updateResult.error.message || "Failed to update appearance settings", 500, "INTERNAL_ERROR");
        }

        const savedSnapshot =
            readAppearanceSnapshotFromMetadata(updateResult.data.user ?? auth.user) ??
            snapshot;

        logApiRoute(request, {
            requestId,
            action: "appearance.put",
            userId: auth.user.id,
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess({
            userId: auth.user.id,
            snapshot: savedSnapshot,
        });
    } catch (error) {
        console.error("[api/v1/appearance] failed to update settings", error);
        logApiRoute(request, {
            requestId,
            action: "appearance.put",
            userId: auth.user.id,
            startedAt,
            success: false,
            status: 500,
            errorCode: "INTERNAL_ERROR",
        });
        return jsonError(
            error instanceof Error ? error.message : "Failed to update appearance settings",
            500,
            "INTERNAL_ERROR",
        );
    }
}

export async function DELETE(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const limitResponse = await enforceRouteLimit(request, "api:v1:appearance:delete", 20, 60);
    if (limitResponse) {
        return limitResponse;
    }

    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
        return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    try {
        const snapshot = createAppearanceSnapshot(DEFAULT_APPEARANCE_SNAPSHOT);
        const metadata = readUserMetadata(auth.user);
        const updateResult = await withAppearanceTimeout(
            auth.supabase.auth.updateUser({
                data: {
                    ...metadata,
                    app_appearance: snapshot,
                },
            }),
            "Appearance reset",
        );

        if (updateResult.error) {
            console.error("[api/v1/appearance] reset failed", updateResult.error);
            logApiRoute(request, {
                requestId,
                action: "appearance.delete",
                userId: auth.user.id,
                startedAt,
                success: false,
                status: 500,
                errorCode: "INTERNAL_ERROR",
            });
            return jsonError(updateResult.error.message || "Failed to reset appearance settings", 500, "INTERNAL_ERROR");
        }

        logApiRoute(request, {
            requestId,
            action: "appearance.delete",
            userId: auth.user.id,
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess({
            userId: auth.user.id,
            snapshot,
        });
    } catch (error) {
        console.error("[api/v1/appearance] failed to reset settings", error);
        logApiRoute(request, {
            requestId,
            action: "appearance.delete",
            userId: auth.user.id,
            startedAt,
            success: false,
            status: 500,
            errorCode: "INTERNAL_ERROR",
        });
        return jsonError(
            error instanceof Error ? error.message : "Failed to reset appearance settings",
            500,
            "INTERNAL_ERROR",
        );
    }
}
