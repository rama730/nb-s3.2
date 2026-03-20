import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

export function repoPath(...segments: string[]) {
    return path.join(process.cwd(), ...segments)
}

export function ensureDirectory(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true })
}

export function writeJsonFile(filePath: string, value: unknown) {
    ensureDirectory(path.dirname(filePath))
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function readJsonFileIfExists<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

export function parseArgs(argv: string[]) {
    const result: Record<string, string | boolean> = {}

    for (const arg of argv) {
        if (!arg.startsWith('--')) continue

        const trimmed = arg.slice(2)
        if (!trimmed) continue

        const equalsIndex = trimmed.indexOf('=')
        if (equalsIndex === -1) {
            result[trimmed] = true
            continue
        }

        const key = trimmed.slice(0, equalsIndex)
        const value = trimmed.slice(equalsIndex + 1)
        result[key] = value
    }

    return result
}

export function getBooleanArg(
    args: Record<string, string | boolean>,
    key: string,
    fallback = false,
) {
    const value = args[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
    }
    return fallback
}

export function getStringArg(
    args: Record<string, string | boolean>,
    key: string,
    fallback: string,
) {
    const value = args[key]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

export function timestampLabel(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-')
}

export function runCommand(params: {
    label: string
    command: string
    args: string[]
    env?: Record<string, string | undefined>
}) {
    console.log(`[stability] running ${params.label}: ${params.command} ${params.args.join(' ')}`)
    const result = spawnSync(params.command, params.args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            ...params.env,
        },
    })

    return {
        status: result.status ?? 1,
        signal: result.signal ?? null,
    }
}

export function commandExists(command: string) {
    const result = spawnSync(command, ['version'], {
        stdio: 'ignore',
    })
    return result.status === 0
}

export function readFileIfExists(filePath: string) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
}

export function fileExists(filePath: string) {
    return fs.existsSync(filePath)
}

