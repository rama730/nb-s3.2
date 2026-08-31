import { z } from 'zod'

import {
    fileExists,
    getBooleanArg,
    getStringArg,
    parseArgs,
    readJsonFileIfExists,
    repoPath,
    writeJsonFile,
} from './lib/stability'

const REQUIRED_SERVICE_IDS = [
    'supabase_auth',
    'supabase_postgres',
    'supabase_realtime',
    'redis',
    'object_storage',
    'cdn',
    'hosting',
    'presence_service',
    'worker_plane',
] as const

const serviceSchema = z.object({
    id: z.enum(REQUIRED_SERVICE_IDS),
    owner: z.string().min(1),
    plan: z.string().min(1),
    region: z.string().min(1),
    documentedLimit: z.string().min(1),
    measuredPeak: z.string().min(1),
    targetCapacity: z.string().min(1),
    status: z.enum(['approved', 'blocked', 'pending']),
    mitigation: z.string().min(1),
})

const capacityAuditSchema = z.object({
    capturedAt: z.string().datetime(),
    environment: z.enum(['staging', 'production']),
    targetConcurrentUsers: z.number().int().positive(),
    summary: z.object({
        status: z.enum(['approved', 'blocked', 'pending']),
        notes: z.string().min(1),
    }),
    services: z.array(serviceSchema),
    supabaseUsage: z.object({
        periodStart: z.string().datetime(),
        periodEnd: z.string().datetime(),
        regularEgressBytes: z.number().nonnegative(),
        cachedEgressBytes: z.number().nonnegative(),
        realtimeMessages: z.number().int().nonnegative(),
        realtimePeakConnections: z.number().int().nonnegative(),
        monthlyActiveUsers: z.number().int().nonnegative(),
        storageBytes: z.number().int().nonnegative(),
        databaseBytes: z.number().int().nonnegative(),
        storageConcentration: z.object({
            largestOwnerBytes: z.number().int().nonnegative(),
            largestProjectBytes: z.number().int().nonnegative(),
            documentedFixtureBytes: z.number().int().nonnegative(),
            perOwnerSoftBudgetBytes: z.number().int().positive(),
            perProjectSoftBudgetBytes: z.number().int().positive(),
        }),
        edgeInvocations: z.number().int().nonnegative(),
        peakPresenceRoomsPerTab: z.number().int().nonnegative(),
        signedUrlReuseRate: z.number().min(0).max(1),
        attributionDimensions: z.array(z.enum([
            'environment', 'route', 'resource', 'table', 'channel', 'cache_status', 'byte_band',
        ])).min(7),
        attributionCoverage: z.number().min(0).max(1),
        projectedRegularEgressBytesAtPeriodEnd: z.number().nonnegative(),
        projectedCachedEgressBytesAtPeriodEnd: z.number().nonnegative(),
    }),
    alerts: z.array(z.object({
        metric: z.enum([
            'regular_egress_bytes', 'cached_egress_bytes', 'realtime_messages',
            'realtime_peak_connections', 'monthly_active_users', 'storage_bytes',
            'database_bytes', 'edge_invocations', 'presence_rooms_per_tab',
            'signed_url_reuse_rate', 'largest_owner_storage_bytes',
            'largest_project_storage_bytes',
        ]),
        warningThreshold: z.number().nonnegative(),
        criticalThreshold: z.number().nonnegative(),
        owner: z.string().min(1),
    })).min(12),
    globalBlockers: z.array(z.string()),
})

function main() {
    const args = parseArgs(process.argv.slice(2))
    const file = getStringArg(args, 'file', repoPath('ops', 'stability', 'capacity-audit.json'))
    const strict = getBooleanArg(args, 'strict', false) || process.env.STABILITY_REQUIRE_CAPACITY_AUDIT === '1'

    if (!fileExists(file)) {
        const report = {
            checkedAt: new Date().toISOString(),
            file,
            ok: false,
            skipped: !strict,
            reason: 'capacity audit file not found',
        }
        writeJsonFile(repoPath('reports', 'stability', 'capacity-audit', 'latest.json'), report)
        if (!strict) {
            console.log('[capacity-audit] file not found; skipping because strict mode is off.')
            return
        }
        throw new Error(`capacity audit file not found: ${file}`)
    }

    const raw = readJsonFileIfExists<unknown>(file)
    const parsed = capacityAuditSchema.safeParse(raw)
    if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
    }

    const seen = new Set(parsed.data.services.map((service) => service.id))
    const missingServices = REQUIRED_SERVICE_IDS.filter((id) => !seen.has(id))
    const pendingServices = parsed.data.services.filter((service) => service.status === 'pending').map((service) => service.id)
    const blockedServices = parsed.data.services.filter((service) => service.status === 'blocked').map((service) => service.id)
    const ok = missingServices.length === 0
        && blockedServices.length === 0
        && (strict ? pendingServices.length === 0 && parsed.data.summary.status === 'approved' : true)

    const report = {
        checkedAt: new Date().toISOString(),
        file,
        ok,
        strict,
        missingServices,
        pendingServices,
        blockedServices,
        summaryStatus: parsed.data.summary.status,
        supabaseUsage: parsed.data.supabaseUsage,
        alertMetrics: parsed.data.alerts.map((alert) => alert.metric),
        globalBlockers: parsed.data.globalBlockers,
    }

    writeJsonFile(repoPath('reports', 'stability', 'capacity-audit', 'latest.json'), report)

    if (!ok) {
        throw new Error(`capacity audit is not ready. Missing: ${missingServices.join(', ') || 'none'}; pending: ${pendingServices.join(', ') || 'none'}; blocked: ${blockedServices.join(', ') || 'none'}`)
    }

    console.log('[capacity-audit] ok')
}

try {
    main()
} catch (error) {
    console.error('[capacity-audit] failed:', error)
    process.exit(1)
}
