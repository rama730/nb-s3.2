import { z } from 'zod'

import {
    fileExists,
    getBooleanArg,
    getStringArg,
    parseArgs,
    readFileIfExists,
    readJsonFileIfExists,
    repoPath,
    writeJsonFile,
} from './lib/stability'

const rolloutPlanSchema = z.object({
    preparedAt: z.string().datetime(),
    environment: z.literal('production'),
    owner: z.string().min(1),
    status: z.enum(['approved', 'blocked', 'pending']),
    rollback: z.object({
        owner: z.string().min(1),
        command: z.string().min(1),
        dashboardUrl: z.string().min(1),
        alertPolicyUrl: z.string().min(1),
    }),
    stages: z.array(z.object({
        name: z.string().min(1),
        status: z.enum(['approved', 'blocked', 'pending']),
        soakHours: z.number().nonnegative(),
        entryCriteria: z.array(z.string().min(1)).min(1),
        exitCriteria: z.array(z.string().min(1)).min(1),
    })).min(3),
    notes: z.array(z.string()),
})

type JsonReport = {
    ok?: boolean
    results?: Array<{ ok?: boolean; label?: string }>
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const strict = getBooleanArg(args, 'strict', false)
    const rolloutFile = getStringArg(args, 'rollout-file', repoPath('ops', 'stability', 'production-rollout.json'))
    const releaseReportPath = getStringArg(args, 'release-report', repoPath('reports', 'stability', 'release', 'latest.json'))
    const loadReportPath = getStringArg(args, 'load-report', repoPath('reports', 'stability', 'load', 'latest.json'))
    const capacityAuditPath = getStringArg(args, 'capacity-report', repoPath('reports', 'stability', 'capacity-audit', 'latest.json'))

    const errors: string[] = []
    const warnings: string[] = []

    if (!fileExists(rolloutFile)) {
        if (strict) errors.push(`missing rollout file ${rolloutFile}`)
        else warnings.push(`missing rollout file ${rolloutFile}`)
    } else {
        const rollout = rolloutPlanSchema.parse(readJsonFileIfExists<unknown>(rolloutFile))
        if (rollout.status !== 'approved') {
            if (strict) errors.push(`rollout plan status is ${rollout.status}`)
            else warnings.push(`rollout plan status is ${rollout.status}`)
        }
        const blockedStages = rollout.stages.filter((stage) => stage.status === 'blocked').map((stage) => stage.name)
        const pendingStages = rollout.stages.filter((stage) => stage.status === 'pending').map((stage) => stage.name)
        if (blockedStages.length > 0) errors.push(`blocked rollout stages: ${blockedStages.join(', ')}`)
        if (strict && pendingStages.length > 0) errors.push(`pending rollout stages: ${pendingStages.join(', ')}`)
        if (!strict && pendingStages.length > 0) warnings.push(`pending rollout stages: ${pendingStages.join(', ')}`)
    }

    const releaseReport = readJsonFileIfExists<JsonReport>(releaseReportPath)
    if (!releaseReport) {
        if (strict) errors.push(`missing release report ${releaseReportPath}`)
        else warnings.push(`missing release report ${releaseReportPath}`)
    } else if (!releaseReport.ok) {
        errors.push('latest stability release gate report is not ok')
    }

    const loadReport = readJsonFileIfExists<{ ok?: boolean; results?: Array<{ ok?: boolean; skipped?: boolean; suite?: string }> }>(loadReportPath)
    if (!loadReport) {
        if (strict) errors.push(`missing load report ${loadReportPath}`)
        else warnings.push(`missing load report ${loadReportPath}`)
    } else if (!loadReport.ok) {
        errors.push('latest load suite report is not ok')
    }

    const capacityReport = readJsonFileIfExists<{ ok?: boolean; skipped?: boolean; reason?: string }>(capacityAuditPath)
    if (!capacityReport) {
        if (strict) errors.push(`missing capacity audit report ${capacityAuditPath}`)
        else warnings.push(`missing capacity audit report ${capacityAuditPath}`)
    } else if (!capacityReport.ok && capacityReport.skipped && !strict) {
        warnings.push(`capacity audit report skipped: ${capacityReport.reason || 'no reason provided'}`)
    } else if (!capacityReport.ok) {
        errors.push('capacity audit report is not ok')
    }

    const e2eRunId = readFileIfExists(repoPath('.e2e-last-run-id'))?.trim() || ''
    if (!e2eRunId) {
        if (strict) errors.push('missing .e2e-last-run-id')
        else warnings.push('missing .e2e-last-run-id')
    }

    const report = {
        checkedAt: new Date().toISOString(),
        strict,
        ok: errors.length === 0,
        errors,
        warnings,
    }

    writeJsonFile(repoPath('reports', 'stability', 'rollout', 'latest.json'), report)

    if (errors.length > 0) {
        throw new Error(errors.join('\n'))
    }

    console.log('[production-rollout] ok')
    if (warnings.length > 0) {
        console.log(`[production-rollout] warnings:\n- ${warnings.join('\n- ')}`)
    }
}

try {
    main()
} catch (error) {
    console.error('[production-rollout] failed:', error)
    process.exit(1)
}
