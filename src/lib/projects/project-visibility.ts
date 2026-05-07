export type ProjectVisibility = "public" | "private";
export type ProjectVisibilityInput = ProjectVisibility | "unlisted" | string | null | undefined;

/**
 * Product visibility is intentionally Public/Private only.
 * Only explicit `public` and legacy `unlisted` rows are publicly readable.
 * Unknown, missing, or corrupted values fail closed as private.
 */
export function normalizeProjectVisibility(value: unknown): ProjectVisibility {
    if (value === "public" || value === "unlisted") return "public";
    return "private";
}

export function isProjectVisibility(value: unknown): value is ProjectVisibility {
    return value === "public" || value === "private";
}

export function isProjectPubliclyReadableVisibility(value: unknown) {
    return normalizeProjectVisibility(value) === "public";
}

export function formatProjectVisibility(value: unknown) {
    return normalizeProjectVisibility(value) === "private" ? "Private" : "Public";
}
