/**
 * Messages feature flags.
 *
 * V2 is the only active messaging system. The V1 codepath and its
 * `hardeningV1` flag have been removed.
 */
export function isMessagesV2Enabled(_userId?: string | null): boolean {
    return true;
}
