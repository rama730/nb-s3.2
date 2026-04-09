import { getAvailabilityLabel } from "@/lib/ui/status-config";

export const MIN_PROFILE_METADATA_BIO_LENGTH = 20;

export type ProfileMetadataInput = {
    username?: string | null;
    fullName?: string | null;
    headline?: string | null;
    location?: string | null;
    bio?: string | null;
};

export function trimDisplayText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function trimOptionalDisplayText(value: unknown): string | null {
    const trimmed = trimDisplayText(value);
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeProjectTitle(value: unknown): string {
    const trimmed = trimDisplayText(value);
    return trimmed.length > 0 ? trimmed : "Untitled project";
}

export function normalizeProjectDescription(...values: unknown[]): string {
    for (const value of values) {
        const trimmed = trimDisplayText(value);
        if (trimmed.length > 0) return trimmed;
    }
    return "No description provided";
}

export function availabilityStatusLabel(value: unknown): string {
    const normalized = trimDisplayText(value).toLowerCase();
    return getAvailabilityLabel(normalized || null);
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function buildProfileMetadataDescription(input: ProfileMetadataInput): string {
    const bio = trimDisplayText(input.bio);
    if (bio.length >= MIN_PROFILE_METADATA_BIO_LENGTH) {
        return bio;
    }

    const fullName = trimDisplayText(input.fullName);
    const username = trimDisplayText(input.username);
    const headline = trimDisplayText(input.headline);
    const location = trimDisplayText(input.location);
    const subject = fullName || username || "This builder";

    if (headline && location) {
        return `${subject} is a ${headline} from ${location} on Edge. View their work and connect.`;
    }

    if (headline) {
        return `${subject} is a ${headline} on Edge. View their work and connect.`;
    }

    if (location) {
        return `${subject} is based in ${location} on Edge. View their work and connect.`;
    }

    return `${subject} is building on Edge. View their work and connect.`;
}

export function buildOwnerProfileTitle(input: ProfileMetadataInput): string {
    const fullName = trimDisplayText(input.fullName);
    const username = trimDisplayText(input.username);
    if (fullName && username) {
        return `${fullName} (@${username}) | Edge`;
    }
    if (fullName) {
        return `${fullName} | Edge`;
    }
    if (username) {
        return `@${username} | Edge`;
    }
    return "Your Profile | Edge";
}

export function buildPublicProfileTitle(input: ProfileMetadataInput): string {
    const fullName = trimDisplayText(input.fullName);
    const username = trimDisplayText(input.username);
    if (fullName && username) {
        return `${fullName} (@${username}) | Edge`;
    }
    if (fullName) {
        return `${fullName} | Edge`;
    }
    if (username) {
        return `@${username} | Edge`;
    }
    return "Profile | Edge";
}

export function initialsForName(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const trimmed = trimDisplayText(value);
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/).slice(0, 2);
        const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
        if (initials) return initials;
    }
    return "U";
}
