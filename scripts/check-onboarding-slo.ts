import { config } from 'dotenv'
import postgres from 'postgres'

config({ path: '.env.local' })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
}

const MIN_SUCCESS_RATE = Number(process.env.ONBOARDING_SLO_MIN_SUCCESS_RATE || '0.97')
const MAX_ERROR_COUNT = Number(process.env.ONBOARDING_SLO_MAX_ERRORS_PER_DAY || '25')

async function main() {
    const databaseUrl = DATABASE_URL
    if (!databaseUrl) {
        console.error('DATABASE_URL is required')
        process.exit(1)
    }
    const sql = postgres(databaseUrl, { max: 1 })
    try {
        const rows = await sql<{
            day: string
            submit_starts: number
            submit_successes: number
            submit_errors: number
            submit_success_rate: string
        }[]>`
            SELECT
                day::text AS day,
                submit_starts,
                submit_successes,
                submit_errors,
                submit_success_rate::text AS submit_success_rate
            FROM onboarding_slo_daily
            ORDER BY day DESC
            LIMIT 1
        `

        if (rows.length === 0) {
            console.log('No onboarding SLO data yet; skipping failure gate.')
            return
        }

        const latest = rows[0]
        const successRate = Number(latest.submit_success_rate)
        const errors = Number(latest.submit_errors)

        console.log('Onboarding SLO latest day:', latest.day)
        console.log('submit_starts=', latest.submit_starts)
        console.log('submit_successes=', latest.submit_successes)
        console.log('submit_errors=', latest.submit_errors)
        console.log('submit_success_rate=', successRate)

        if (Number.isFinite(successRate) && successRate < MIN_SUCCESS_RATE) {
            console.error(`Onboarding success rate ${successRate} is below ${MIN_SUCCESS_RATE}`)
            process.exitCode = 1
        }

        if (Number.isFinite(errors) && errors > MAX_ERROR_COUNT) {
            console.error(`Onboarding submit errors ${errors} exceed ${MAX_ERROR_COUNT}`)
            process.exitCode = 1
        }
    } finally {
        await sql.end()
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    console.error('Failed to check onboarding SLO:', message)
    if (stack) {
        console.error(stack)
    }
    process.exit(1)
})
