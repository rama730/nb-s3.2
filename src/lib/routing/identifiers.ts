/**
 * Profile routing utilities
 */

interface ProfileLike {
    username?: string | null;
    id?: string;
}

/**
 * Generate the href for a profile page.
 * Prefers username-based URLs if available, falls back to ID.
 */
export function profileHref(profile: ProfileLike): string {
    if (profile.username) {
        return `/u/${profile.username}`;
    }
    if (profile.id) {
        // Fallback for ID-only, though ideally we should have username
        return `/u/${profile.id}`;
    }
    return '/profile'; // My profile fallback
}
