import { config as loadDotenv } from 'dotenv'
import { validateEnv } from '../src/lib/env'

async function main() {
    loadDotenv({ path: '.env.local' })
    loadDotenv()

    const target = process.argv.includes('--target=production')
        || process.argv.includes('--target')
        || process.argv.includes('production')
        ? 'production'
        : 'current'

    validateEnv({
        ...process.env,
        ...(target === 'production' ? { NODE_ENV: 'production' } : {}),
    })
    console.log(`[security-env-contract] ok (${target})`)
}

main().catch((error) => {
    console.error('[security-env-contract] failed:', error)
    process.exit(1)
})

export {}
