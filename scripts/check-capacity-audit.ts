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
