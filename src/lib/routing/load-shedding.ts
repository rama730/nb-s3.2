import type { RouteClass } from '@/lib/routing/route-class'
import { consumeRateLimitPolicy } from '@/lib/security/rate-limit'

export type RouteLoadSheddingPolicy = {
    routeClass: RouteClass
    burst: number
    refillRate: number
    failMode: 'fail_closed' | 'stale_or_shed'
}

function readEnabledFlag() {
    if (process.env.LOAD_SHEDDING_ENABLED === 'true') return true
    if (process.env.LOAD_SHEDDING_ENABLED === 'false') return false
    return process.env.NODE_ENV === 'production' && process.env.LOAD_SHEDDING_ENABLED !== 'false'
}

function readPositiveEnv(name: string, fallback: number) {
    const raw = Number(process.env[name] || fallback)
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

const ROUTE_LOAD_SHEDDING_POLICIES: Record<RouteClass, RouteLoadSheddingPolicy> = {
    public_cached: {
        routeClass: 'public_cached',
        burst: readPositiveEnv('LOAD_SHED_PUBLIC_BURST', 5000),
        refillRate: readPositiveEnv('LOAD_SHED_PUBLIC_REFILL_PER_SECOND', 500),
        failMode: 'stale_or_shed',
    },
    user_shell: {
        routeClass: 'user_shell',
        burst: readPositiveEnv('LOAD_SHED_USER_SHELL_BURST', 2000),
        refillRate: readPositiveEnv('LOAD_SHED_USER_SHELL_REFILL_PER_SECOND', 200),
        failMode: 'fail_closed',
    },
    active_surface: {
        routeClass: 'active_surface',
        burst: readPositiveEnv('LOAD_SHED_ACTIVE_SURFACE_BURST', 1000),
        refillRate: readPositiveEnv('LOAD_SHED_ACTIVE_SURFACE_REFILL_PER_SECOND', 100),
        failMode: 'fail_closed',
    },
}

export async function consumeRouteClassLoadShedding(routeClass: RouteClass) {
    if (!readEnabledFlag()) {
        return {
            enabled: false,
            allowed: true,
            policy: ROUTE_LOAD_SHEDDING_POLICIES[routeClass],
        }
    }

    const policy = ROUTE_LOAD_SHEDDING_POLICIES[routeClass]
    const result = await consumeRateLimitPolicy({
        scope: `load-shed:${routeClass}`,
        burst: policy.burst,
        refillRate: policy.refillRate,
        keyParts: ['global'],
        failMode: policy.failMode,
    })

    return {
        enabled: true,
        allowed: result.allowed,
        degraded: result.degraded,
        resetAt: result.resetAt,
        remaining: result.remaining,
        policy,
    }
}

