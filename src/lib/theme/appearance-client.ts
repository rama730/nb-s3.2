import {
    APPEARANCE_SNAPSHOT_VERSION,
    isAccentColor,
    isDensity,
    isThemeMode,
    type AppearanceSnapshot,
} from "@/lib/theme/appearance";

export type AppearanceSyncState = "idle" | "saving" | "saved" | "save_failed";

export type AppearanceSettingsPayload = {
    userId: string | null;
    snapshot: AppearanceSnapshot | null;
};

const APPEARANCE_REQUEST_TIMEOUT_MS = 4_000;

function isAppearanceSnapshot(snapshot: unknown): snapshot is AppearanceSnapshot {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        return false;
    }

    const candidate = snapshot as Record<string, unknown>;
    return (
        candidate.version === APPEARANCE_SNAPSHOT_VERSION &&
        isThemeMode(candidate.theme) &&
        isAccentColor(candidate.accentColor) &&
        isDensity(candidate.density) &&
        typeof candidate.reduceMotion === "boolean" &&
        typeof candidate.updatedAt === "string" &&
        Number.isFinite(new Date(candidate.updatedAt).getTime())
    );
}

async function fetchAppearanceWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APPEARANCE_REQUEST_TIMEOUT_MS);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Appearance request timed out");
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function readAppearanceJson(response: Response): Promise<AppearanceSettingsPayload> {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        throw new Error(`Appearance endpoint returned non-JSON response (${response.status})`);
    }

    const json = await response.json();
    const message =
        (typeof json?.error === "string" && json.error) ||
        (typeof json?.message === "string" && json.message) ||
        `Appearance request failed (${response.status})`;

    if (!response.ok || json?.success === false) {
        throw new Error(message);
    }

    return {
        userId: typeof json?.data?.userId === "string" ? json.data.userId : null,
        snapshot: isAppearanceSnapshot(json?.data?.snapshot) ? json.data.snapshot : null,
    };
}

export async function readAppearanceSettings(): Promise<AppearanceSettingsPayload> {
    const response = await fetchAppearanceWithTimeout("/api/v1/appearance", {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
    });
    return readAppearanceJson(response);
}

export async function writeAppearanceSettings(
    snapshot: AppearanceSnapshot,
): Promise<AppearanceSettingsPayload> {
    const response = await fetchAppearanceWithTimeout("/api/v1/appearance", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ snapshot }),
    });
    return readAppearanceJson(response);
}

export async function resetAppearanceSettings(): Promise<AppearanceSettingsPayload> {
    const response = await fetchAppearanceWithTimeout("/api/v1/appearance", {
        method: "DELETE",
        headers: {
            Accept: "application/json",
        },
    });
    return readAppearanceJson(response);
}
