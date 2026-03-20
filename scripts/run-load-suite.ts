import fs from 'node:fs'

import {
    commandExists,
    ensureDirectory,
    fileExists,
    getStringArg,
    parseArgs,
    repoPath,
    runCommand,
    timestampLabel,
    writeJsonFile,
} from './lib/stability'

type SuiteName =
    | 'public-projects-feed'
    | 'auth-entry-pages'
    | 'authenticated-shells'
    | 'workspace-bootstrap'
    | 'messages-reconnect-storm'
    | 'presence-room-fanout'
    | 'worker-isolation'

const SUITE_CONFIG: Record<SuiteName, {
    script: string;
    requiresAuthCookie: boolean;
    requiredEnv?: string[];
    thresholds: {
        p95Ms: number;
        failedRate: number;
        checksRate: number;
        extraTrendP95Ms?: number;
    };
    extraTrendMetric?: string;
}> = {
    'public-projects-feed': {
        script: repoPath('qa', 'load', 'public-projects-feed.k6.js'),
        requiresAuthCookie: false,
        thresholds: { p95Ms: 400, failedRate: 0.02, checksRate: 0.99 },
    },
    'auth-entry-pages': {
        script: repoPath('qa', 'load', 'auth-entry-pages.k6.js'),
        requiresAuthCookie: false,
        thresholds: { p95Ms: 500, failedRate: 0.02, checksRate: 0.99 },
    },
    'authenticated-shells': {
        script: repoPath('qa', 'load', 'authenticated-shells.k6.js'),
        requiresAuthCookie: true,
        thresholds: { p95Ms: 800, failedRate: 0.02, checksRate: 0.99 },
    },
    'workspace-bootstrap': {
        script: repoPath('qa', 'load', 'workspace-bootstrap.k6.js'),
        requiresAuthCookie: true,
        thresholds: { p95Ms: 900, failedRate: 0.02, checksRate: 0.99 },
    },
    'messages-reconnect-storm': {
        script: repoPath('qa', 'load', 'messages-reconnect-storm.k6.js'),
        requiresAuthCookie: true,
        thresholds: { p95Ms: 900, failedRate: 0.03, checksRate: 0.99 },
    },
    'presence-room-fanout': {
        script: repoPath('qa', 'load', 'presence-room-fanout.k6.js'),
        requiresAuthCookie: true,
        requiredEnv: ['PRESENCE_ROOM_ID'],
        thresholds: { p95Ms: 500, failedRate: 0.03, checksRate: 0.99, extraTrendP95Ms: 400 },
        extraTrendMetric: 'presence_ack_ms',
    },
    'worker-isolation': {
        script: repoPath('qa', 'load', 'worker-isolation.k6.js'),
        requiresAuthCookie: true,
        requiredEnv: ['WORKER_LOAD_URL'],
        thresholds: { p95Ms: 900, failedRate: 0.03, checksRate: 0.99 },
    },
}

type K6Summary = {
    metrics?: {
        http_req_duration?: { values?: Record<string, number> }
        http_req_failed?: { values?: Record<string, number> }
        checks?: { values?: Record<string, number> }
        [key: string]: { values?: Record<string, number> } | undefined
    }
}

function parseSuiteList(raw: string): SuiteName[] {
    const requested = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean) as SuiteName[]
    return requested.length > 0 ? requested : Object.keys(SUITE_CONFIG) as SuiteName[]
}

function normalizeSummary(
    summaryPath: string,
    thresholds: { p95Ms: number; failedRate: number; checksRate: number; extraTrendP95Ms?: number },
    extraTrendMetric?: string,
) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as K6Summary
    const p95 = Number(summary.metrics?.http_req_duration?.values?.['p(95)'] ?? NaN)
    const failedRate = Number(summary.metrics?.http_req_failed?.values?.rate ?? NaN)
    const checksRate = Number(summary.metrics?.checks?.values?.rate ?? NaN)
    const extraTrendP95 = extraTrendMetric
        ? Number(summary.metrics?.[extraTrendMetric]?.values?.['p(95)'] ?? NaN)
        : NaN

    return {
        p95Ms: Number.isFinite(p95) ? p95 : null,
        failedRate: Number.isFinite(failedRate) ? failedRate : null,
        checksRate: Number.isFinite(checksRate) ? checksRate : null,
        extraTrendMetric: extraTrendMetric ?? null,
        extraTrendP95Ms: Number.isFinite(extraTrendP95) ? extraTrendP95 : null,
        passed:
            Number.isFinite(p95)
            && Number.isFinite(failedRate)
            && Number.isFinite(checksRate)
            && p95 <= thresholds.p95Ms
            && failedRate <= thresholds.failedRate
            && checksRate >= thresholds.checksRate,
        extraTrendPassed:
            !extraTrendMetric
            || (
                Number.isFinite(extraTrendP95)
                && typeof thresholds.extraTrendP95Ms === 'number'
                && extraTrendP95 <= thresholds.extraTrendP95Ms
            ),
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const baseUrl = getStringArg(args, 'base-url', process.env.BASE_URL?.trim() || '')
    const authCookie = getStringArg(args, 'auth-cookie', process.env.AUTH_COOKIE?.trim() || '')
    const suites = parseSuiteList(getStringArg(args, 'suites', process.env.STABILITY_LOAD_SUITES || ''))

    if (!baseUrl) {
        throw new Error('BASE_URL or --base-url is required')
    }
    if (!commandExists('k6')) {
        throw new Error('k6 is required on PATH to run the load suite')
    }

    const timestamp = timestampLabel()
    const reportDir = repoPath('reports', 'stability', 'load', timestamp)
    ensureDirectory(reportDir)

    const results: Array<Record<string, unknown>> = []
    let overallOk = true

    for (const suiteName of suites) {
        const suite = SUITE_CONFIG[suiteName]
        if (!suite) {
            throw new Error(`unknown suite ${suiteName}`)
        }
        if (!fileExists(suite.script)) {
            throw new Error(`missing k6 script ${suite.script}`)
        }

        if (suite.requiresAuthCookie && !authCookie) {
            results.push({
                suite: suiteName,
                script: suite.script,
                skipped: true,
                reason: 'AUTH_COOKIE missing',
            })
            overallOk = false
            continue
        }
        if (suite.requiredEnv?.some((name) => !(process.env[name]?.trim()))) {
            results.push({
                suite: suiteName,
                script: suite.script,
                skipped: true,
                reason: `Missing required env: ${suite.requiredEnv.filter((name) => !(process.env[name]?.trim())).join(', ')}`,
            })
            overallOk = false
            continue
        }

        const summaryPath = repoPath('reports', 'stability', 'load', timestamp, `${suiteName}.summary.json`)
        const runResult = runCommand({
            label: suiteName,
            command: 'k6',
            args: ['run', '--summary-export', summaryPath, suite.script],
            env: {
                BASE_URL: baseUrl,
                AUTH_COOKIE: authCookie || undefined,
                PRESENCE_ROOM_ID: process.env.PRESENCE_ROOM_ID || undefined,
                PRESENCE_ROOM_TYPE: process.env.PRESENCE_ROOM_TYPE || undefined,
                PRESENCE_WS_LOAD_URL: process.env.PRESENCE_WS_LOAD_URL || undefined,
                WORKER_BASE_URL: process.env.WORKER_BASE_URL || undefined,
                WORKER_LOAD_URL: process.env.WORKER_LOAD_URL || undefined,
            },
        })

        const normalized = normalizeSummary(summaryPath, suite.thresholds, suite.extraTrendMetric)
        const ok = runResult.status === 0 && normalized.passed && normalized.extraTrendPassed
        overallOk = overallOk && ok

        results.push({
            suite: suiteName,
            script: suite.script,
            summaryPath,
            exitStatus: runResult.status,
            thresholds: suite.thresholds,
            ...normalized,
            ok,
        })
    }

    const manifest = {
        generatedAt: new Date().toISOString(),
        baseUrl,
        suites,
        ok: overallOk,
        reportDir,
        results,
    }

    writeJsonFile(repoPath('reports', 'stability', 'load', timestamp, 'manifest.json'), manifest)
    writeJsonFile(repoPath('reports', 'stability', 'load', 'latest.json'), manifest)

    if (!overallOk) {
        throw new Error('one or more load suites failed or were skipped')
    }

    console.log(`[stability-load] ok (${suites.length} suites)`)
}

try {
    main()
} catch (error) {
    console.error('[stability-load] failed:', error)
    process.exit(1)
}
