import { parseAppearanceSnapshot, type AppearanceSnapshot } from "@/lib/theme/appearance";

export type AppearanceSyncState = "idle" | "saving" | "saved" | "save_failed";

export type AppearanceSettingsPayload = {
    userId: string | null;
    snapshot: AppearanceSnapshot | null;
};

const APPEARANCE_REQUEST_TIMEOUT_MS = 4_000;
let appearanceReadInFlight: Promise<AppearanceSettingsPayload> | null = null;

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
        snapshot: parseAppearanceSnapshot(json?.data?.snapshot),
    };
}

export async function readAppearanceSettings(): Promise<AppearanceSettingsPayload> {
    if (appearanceReadInFlight) {
        return appearanceReadInFlight;
    }

    appearanceReadInFlight = (async () => {
        const response = await fetch("/api/v1/appearance", {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(APPEARANCE_REQUEST_TIMEOUT_MS),
        });
        return readAppearanceJson(response);
    })();

    try {
        return await appearanceReadInFlight;
    } finally {
        appearanceReadInFlight = null;
    }
}

export async function writeAppearanceSettings(
    snapshot: AppearanceSnapshot,
): Promise<AppearanceSettingsPayload> {
    const response = await fetch("/api/v1/appearance", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ snapshot }),
        signal: AbortSignal.timeout(APPEARANCE_REQUEST_TIMEOUT_MS),
    });
    return readAppearanceJson(response);
}
