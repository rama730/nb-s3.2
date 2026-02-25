export const STALE_TIMES = {
    REALTIME: 15_000,
    STANDARD: 60_000,
    STABLE: 5 * 60_000,
} as const

export const QUERY_DEFAULTS = {
    staleTime: STALE_TIMES.STANDARD,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
} as const
