import { getBooleanArg, parseArgs, readJsonFileIfExists, repoPath, writeJsonFile } from './lib/stability'

type LoadResult = {
    suite?: string
    ok?: boolean
    p95Ms?: number | null
    failedRate?: number | null
}

type Status = 'READY' | 'CONDITIONAL' | 'BLOCKED'

function decideStatus(input: {
    dbOk: boolean
    releaseOk: boolean
    capacityOk: boolean
    rolloutOk: boolean
    loadResults: LoadResult[]
}) {
    const blockers: string[] = []
    const recommendations: string[] = []

    if (!input.dbOk) blockers.push('Workspace counter migration has not been verified in the target database.')
    if (!input.releaseOk) blockers.push('Release validation report is missing or failed.')
    if (!input.capacityOk) blockers.push('External dependency capacity audit is missing or not approved.')
    if (!input.rolloutOk) blockers.push('Production rollout readiness is missing or not approved.')

    const loadFailures = input.loadResults.filter((result) => result.ok === false)
    if (loadFailures.length > 0) {
        blockers.push(`Load suite failures: ${loadFailures.map((result) => result.suite).join(', ')}`)
    }

    const reconnectStorm = input.loadResults.find((result) => result.suite === 'messages-reconnect-storm')
    if (reconnectStorm && (reconnectStorm.p95Ms ?? 0) > 900) {
        recommendations.push('Validate the dedicated presence service under reconnect-storm load before claiming 1M headroom.')
    }

    const presenceFanout = input.loadResults.find((result) => result.suite === 'presence-room-fanout')
    if (presenceFanout && presenceFanout.ok === false) {
        recommendations.push('Validate the dedicated presence service deployment, token route, and Redis pub/sub health before broad rollout.')
    }

    const workerIsolation = input.loadResults.find((result) => result.suite === 'worker-isolation')
    if (workerIsolation && workerIsolation.ok === false) {
        recommendations.push('Verify worker-plane ingress separation and ensure Git/import traffic is isolated from shell latency.')
    }

    const workspaceBootstrap = input.loadResults.find((result) => result.suite === 'workspace-bootstrap')
    if (workspaceBootstrap && (workspaceBootstrap.failedRate ?? 0) > 0.02) {
        recommendations.push('Revisit workspace bootstrap quotas and Redis load-shedding thresholds before broad rollout.')
    }

    const status: Status =
        blockers.length > 0
            ? 'BLOCKED'
            : input.loadResults.length === 0
                ? 'CONDITIONAL'
                : 'READY'

    return {
        status,
        blockers,
        recommendations,
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const strict = getBooleanArg(args, 'strict', false)
    const dbReport = readJsonFileIfExists<{ ok?: boolean }>(repoPath('reports', 'stability', 'db', 'workspace-counters.json'))
    const envReport = readJsonFileIfExists<{ ok?: boolean }>(repoPath('reports', 'stability', 'env', 'production.json'))
    const releaseReport = readJsonFileIfExists<{ ok?: boolean }>(repoPath('reports', 'stability', 'release', 'latest.json'))
    const capacityReport = readJsonFileIfExists<{ ok?: boolean }>(repoPath('reports', 'stability', 'capacity-audit', 'latest.json'))
    const rolloutReport = readJsonFileIfExists<{ ok?: boolean; strict?: boolean; warnings?: string[] }>(repoPath('reports', 'stability', 'rollout', 'latest.json'))
    const loadReport = readJsonFileIfExists<{ ok?: boolean; results?: LoadResult[] }>(repoPath('reports', 'stability', 'load', 'latest.json'))
    const rolloutWarnings = rolloutReport?.warnings?.length ?? 0
    const rolloutEvidenceOk =
        rolloutReport?.ok === true
        && (rolloutReport.strict === true || rolloutWarnings === 0)

    const decision = decideStatus({
        dbOk: dbReport?.ok === true,
        releaseOk: releaseReport?.ok === true,
        capacityOk: capacityReport?.ok === true,
        rolloutOk: rolloutEvidenceOk,
        loadResults: loadReport?.results || [],
    })

    const report = {
        generatedAt: new Date().toISOString(),
        strict,
        ...decision,
        evidence: {
            dbReport: dbReport ? 'reports/stability/db/workspace-counters.json' : null,
            envReport: envReport ? 'reports/stability/env/production.json' : null,
            releaseReport: releaseReport ? 'reports/stability/release/latest.json' : null,
            capacityReport: capacityReport ? 'reports/stability/capacity-audit/latest.json' : null,
            rolloutReport: rolloutReport ? 'reports/stability/rollout/latest.json' : null,
            loadReport: loadReport ? 'reports/stability/load/latest.json' : null,
        },
    }

    writeJsonFile(repoPath('reports', 'stability', 'headroom', 'latest.json'), report)

    console.log(`[1m-readiness] status=${decision.status}`)
    if (decision.blockers.length > 0) {
        console.log(`[1m-readiness] blockers:\n- ${decision.blockers.join('\n- ')}`)
    }
    if (decision.recommendations.length > 0) {
        console.log(`[1m-readiness] recommendations:\n- ${decision.recommendations.join('\n- ')}`)
    }

    if (strict && decision.status !== 'READY') {
        process.exit(1)
    }
}

main()
