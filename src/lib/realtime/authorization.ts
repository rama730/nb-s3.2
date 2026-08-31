const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Private Broadcast/Presence must not start until the matching
 * `realtime.messages` policies have been applied and verified in Supabase.
 * The default is deliberately fail-closed: ordinary database Realtime keeps
 * working, while optional presence/typing/stats channels remain unavailable.
 */
export function isPrivateRealtimeAuthorizationEnabled() {
  const value = process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
  return ENABLED_VALUES.has(value?.trim().toLowerCase() ?? "");
}
