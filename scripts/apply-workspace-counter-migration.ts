import fs from 'node:fs'

import postgres from 'postgres'

import {
    getBooleanArg,
    parseArgs,
    repoPath,
    writeJsonFile,
} from './lib/stability'

const REQUIRED_PROFILE_COLUMNS = [
    'workspace_inbox_count',
    'workspace_due_today_count',
    'workspace_overdue_count',
    'workspace_in_progress_count',
]

const REQUIRED_INDEXES = [
    'profiles_workspace_inbox_count_idx',
    'profiles_workspace_due_today_count_idx',
    'profiles_workspace_overdue_count_idx',
    'profiles_workspace_in_progress_count_idx',
    'tasks_assignee_status_due_idx',
]

function splitStatements(sqlText: string) {
    return sqlText
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0)
}

async function readCurrentState(sql: postgres.Sql<Record<string, unknown>>) {
    const columns = await sql<{ column_name: string }[]>`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name in ${sql(REQUIRED_PROFILE_COLUMNS)}
    `

    const indexes = await sql<{ indexname: string }[]>`
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname in ${sql(REQUIRED_INDEXES)}
    `

    const existingColumns = new Set(columns.map((row) => row.column_name))
    const existingIndexes = new Set(indexes.map((row) => row.indexname))

    return {
        missingColumns: REQUIRED_PROFILE_COLUMNS.filter((name) => !existingColumns.has(name)),
        missingIndexes: REQUIRED_INDEXES.filter((name) => !existingIndexes.has(name)),
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const checkOnly = getBooleanArg(args, 'check-only', false)
    const connectionString = process.env.DATABASE_URL?.trim()

    if (!connectionString) {
        throw new Error('DATABASE_URL is required.')
    }

    const sql = postgres(connectionString, { max: 1 })
    const reportPath = repoPath('reports', 'stability', 'db', 'workspace-counters.json')

    try {
        const before = await readCurrentState(sql)
        let applied = false

        if (!checkOnly && (before.missingColumns.length > 0 || before.missingIndexes.length > 0)) {
            const migrationPath = repoPath('drizzle', '0052_workspace_profile_counters.sql')
            const migrationSql = fs.readFileSync(migrationPath, 'utf8')
            const statements = splitStatements(migrationSql)

            for (const statement of statements) {
                await sql.unsafe(statement)
            }
            applied = true
        }

        const after = await readCurrentState(sql)
        const ok = after.missingColumns.length === 0 && after.missingIndexes.length === 0
        const report = {
            checkedAt: new Date().toISOString(),
            checkOnly,
            applied,
            ok,
            before,
            after,
            migration: 'drizzle/0052_workspace_profile_counters.sql',
        }

        writeJsonFile(reportPath, report)

        if (!ok) {
            throw new Error(
                `workspace counter migration incomplete. Missing columns: ${after.missingColumns.join(', ') || 'none'}; missing indexes: ${after.missingIndexes.join(', ') || 'none'}`,
            )
        }

        console.log(`[workspace-counter-migration] ok (${applied ? 'applied and verified' : 'already applied'})`)
    } finally {
        await sql.end()
    }
}

main().catch((error) => {
    console.error('[workspace-counter-migration] failed:', error)
    process.exit(1)
})
