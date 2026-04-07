/**
 * H9: Centralized rate limit configuration matrix.
 * All API route rate limits should reference these constants.
 *
 * Sensitivity tiers:
 *   - CRITICAL: Auth-sensitive operations (password change, MFA, account deletion)
 *   - HIGH: Write operations that modify state
 *   - STANDARD: Read operations with authenticated access
 *   - PUBLIC: Unauthenticated/public-facing reads
 *   - ADMIN: Admin-only endpoints
 *
 * Format: [maxRequests, windowSeconds]
 */

export const RATE_LIMITS = {
    // ── CRITICAL (low frequency, high security impact) ─────────────
    "auth.changePassword":      [10, 3600] as const,  // 10/hour (was 30/min — too generous for security)
    "account.delete":           [3, 3600]  as const,  // 3/hour
    "account.export":           [1, 3600]  as const,  // 1/hour
    "auth.mfa.enroll":          [10, 3600] as const,  // 10/hour
    "auth.mfa.unenroll":        [10, 3600] as const,  // 10/hour
    "auth.recoveryCodes":       [10, 3600] as const,  // 10/hour
    "auth.securityStepUp":      [20, 60]   as const,  // 20/min

    // ── HIGH (write operations) ────────────────────────────────────
    "sessions.delete":          [30, 60]   as const,  // 30/min
    "sessions.deleteAll":       [10, 60]   as const,  // 10/min
    "sessions.deleteOthers":    [10, 60]   as const,  // 10/min
    "appearance.update":        [60, 60]   as const,  // 60/min
    "appearance.delete":        [20, 60]   as const,  // 20/min
    "privacy.update":           [60, 60]   as const,  // 60/min

    // ── STANDARD (read operations, authenticated) ──────────────────
    "security.get":             [120, 60]  as const,  // 120/min
    "appearance.get":           [120, 60]  as const,  // 120/min
    "sessions.list":            [60, 60]   as const,  // 60/min
    "loginHistory.list":        [60, 60]   as const,  // 60/min
    "privacy.get":              [120, 60]  as const,  // 120/min
    "projects.list":            [180, 60]  as const,  // 180/min

    // ── PUBLIC ─────────────────────────────────────────────────────
    "health.check":             [60, 60]   as const,  // 60/min
    "ready.check":              [60, 60]   as const,  // 60/min
    "usernameCheck":            [60, 60]   as const,  // 60/min

    // ── ADMIN ──────────────────────────────────────────────────────
    "admin.reservedUsernames":  [30, 60]   as const,  // 30/min

    // ── GITHUB IMPORT ──────────────────────────────────────────────
    "github.import":            [60, 60]   as const,  // 60/min
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;
