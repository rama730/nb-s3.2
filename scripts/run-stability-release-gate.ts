import { getBooleanArg, getStringArg, parseArgs, repoPath, runCommand, timestampLabel, writeJsonFile } from './lib/stability'

function npmExecutable() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const target = getStringArg(args, 'target', 'staging')
    const includeE2E = getBooleanArg(args, 'include-e2e', false)
    const strictEnv = getBooleanArg(args, 'strict-env', true)
    const timestamp = timestampLabel()

    const commandPlan: Array<{ label: string; command: string; args: string[] }> = [
        {
            label: 'stability-env',
            command: 'npx',
            args: ['tsx', 'scripts/check-stability-env.ts', `--target=${target}`, strictEnv ? '--strict' : '--no-strict'],
        },
        { label: 'lint', command: npmExecutable(), args: ['run', 'lint', '--', '.', '--ext', '.ts,.tsx,.js,.jsx'] },
        { label: 'typecheck', command: npmExecutable(), args: ['run', 'typecheck'] },
        { label: 'test:unit', command: npmExecutable(), args: ['run', 'test:unit'] },
        { label: 'check:db:migration-journal', command: npmExecutable(), args: ['run', 'check:db:migration-journal'] },
        { label: 'check:page-contract', command: npmExecutable(), args: ['run', 'check:page-contract'] },
        { label: 'check:force-dynamic-allowlist', command: npmExecutable(), args: ['run', 'check:force-dynamic-allowlist'] },
        { label: 'check:runtime-boundaries', command: npmExecutable(), args: ['run', 'check:runtime-boundaries'] },
        { label: 'check:hub-canonical-contract', command: npmExecutable(), args: ['run', 'check:hub-canonical-contract'] },
    ]

    if (target === 'production') {
        commandPlan.push({
            label: 'check:hardening-rollout',
            command: npmExecutable(),
            args: ['run', 'check:hardening-rollout'],
        })
    }

    if (includeE2E) {
        commandPlan.push({
            label: target === 'production' ? 'test:e2e:critical:prod' : 'test:e2e:critical:dev',
            command: npmExecutable(),
            args: ['run', target === 'production' ? 'test:e2e:critical:prod' : 'test:e2e:critical:dev'],
        })
    }

    const results: Array<{ label: string; status: number; ok: boolean }> = []
    for (const command of commandPlan) {
        const result = runCommand(command)
        const ok = result.status === 0
        results.push({
            label: command.label,
            status: result.status,
            ok,
        })
        if (!ok) break
    }

    const report = {
        generatedAt: new Date().toISOString(),
        target,
        includeE2E,
        ok: results.every((result) => result.ok),
        results,
    }

    writeJsonFile(repoPath('reports', 'stability', 'release', `${timestamp}.json`), report)
    writeJsonFile(repoPath('reports', 'stability', 'release', 'latest.json'), report)

    if (!report.ok) {
        throw new Error(`release gate failed at ${results.find((result) => !result.ok)?.label || 'unknown step'}`)
    }

    console.log(`[stability-release] ok for ${target}`)
}

try {
    main()
} catch (error) {
    console.error('[stability-release] failed:', error)
    process.exit(1)
}
