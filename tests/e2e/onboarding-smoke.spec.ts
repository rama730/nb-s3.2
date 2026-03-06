import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { scopedName } from './_helpers/fixtures'
import { attachPageMonitoring } from './_helpers/monitoring'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const canManageFixtures = Boolean(supabaseUrl && serviceRoleKey)

function getOnboardingPassword(): string {
    const password = process.env.E2E_ONBOARDING_PASSWORD || process.env.E2E_USER_PASSWORD
    if (!password) {
        throw new Error('E2E_ONBOARDING_PASSWORD (or E2E_USER_PASSWORD) is required for onboarding smoke tests.')
    }
    return password
}

function attachOnboardingMonitoring(page: import('@playwright/test').Page) {
    return attachPageMonitoring(page, {
        allowedConsolePatterns: [
            /Unable to save onboarding draft: Error: An unexpected response was received from the server\./i,
        ],
        allowedPageErrorPatterns: [
            /An unexpected response was received from the server\./i,
        ],
    })
}
const FIXTURE_EMAILS = {
    happy: process.env.E2E_ONBOARDING_HAPPY_EMAIL || 'codex.onboarding.happy@example.com',
    legacy: process.env.E2E_ONBOARDING_LEGACY_EMAIL || 'codex.onboarding.legacy@example.com',
    reserved: process.env.E2E_ONBOARDING_RESERVED_EMAIL || 'codex.onboarding.reserved@example.com',
    collision: process.env.E2E_ONBOARDING_COLLISION_EMAIL || 'codex.onboarding.collision@example.com',
    rateLimit: process.env.E2E_ONBOARDING_RATELIMIT_EMAIL || 'codex.onboarding.ratelimit@example.com',
    idempotent: process.env.E2E_ONBOARDING_IDEMPOTENT_EMAIL || 'codex.onboarding.idempotent@example.com',
}

const EXISTING_USERNAME = process.env.E2E_ONBOARDING_COLLISION_TARGET || 'e2e_6ff73371'

function adminClient() {
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
}

async function ensureOnboardingFixture(email: string) {
    if (!canManageFixtures) return
    const onboardingPassword = getOnboardingPassword()
    const admin = adminClient()

    const usersResponse = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
    })
    const existing = usersResponse.data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase())

    let userId = existing?.id || null
    if (!userId) {
        const created = await admin.auth.admin.createUser({
            email,
            password: onboardingPassword,
            email_confirm: true,
            user_metadata: {
                full_name: 'Onboarding Fixture User',
                onboarded: false,
                username: null,
            },
        })
        if (created.error) {
            throw new Error(`Unable to create onboarding fixture user for ${email}: ${created.error.message}`)
        }
        if (!created.data.user?.id) {
            throw new Error(`Unable to create onboarding fixture user for ${email}`)
        }
        userId = created.data.user.id
    } else {
        const updated = await admin.auth.admin.updateUserById(userId, {
            email,
            password: onboardingPassword,
            user_metadata: {
                full_name: 'Onboarding Fixture User',
                onboarded: false,
                username: null,
            },
        })
        if (updated.error) {
            throw new Error(`Unable to update onboarding fixture user for ${email}: ${updated.error.message}`)
        }
    }

    const { error: upsertError } = await admin
        .from('profiles')
        .upsert({
            id: userId,
            email,
            username: null,
            full_name: 'Onboarding Fixture User',
            updated_at: new Date().toISOString(),
        })
    if (upsertError) {
        throw new Error(`Failed to upsert profile fixture for ${email}: ${upsertError.message}`)
    }

    const { error: deleteDraftError } = await admin
        .from('onboarding_drafts')
        .delete()
        .eq('user_id', userId)
    if (deleteDraftError) {
        throw new Error(`Failed to clear onboarding draft fixture for ${email}: ${deleteDraftError.message}`)
    }
}

async function login(page: import('@playwright/test').Page, email: string) {
    const onboardingPassword = getOnboardingPassword()
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.goto('/login')
        let pathname = new URL(page.url()).pathname
        if (pathname === '/onboarding') return
        if (pathname !== '/login') {
            await page.goto('/login')
            pathname = new URL(page.url()).pathname
            if (pathname === '/onboarding') return
        }

        await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 })
        await page.getByLabel('Email').fill(email)
        await page.getByLabel('Password').fill(onboardingPassword)
        await page.getByRole('button', { name: 'Sign in' }).click()

        try {
            await expect
                .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
                .not.toBe('/login')

            const pathname = new URL(page.url()).pathname
            if (pathname !== '/onboarding') {
                await page.goto('/onboarding')
            }
            await expect
                .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
                .toBe('/onboarding')
            return
        } catch (error) {
            if (attempt === 2) throw error
        }
    }
}

test.describe('Onboarding smoke', () => {
    test.skip(!canManageFixtures, 'Supabase service role is required for onboarding fixture setup')

    test('happy path completes onboarding and redirects to hub', async ({ browser }) => {
        const email = FIXTURE_EMAILS.happy
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)

        await page.getByLabel('Full Name').fill('Onboarding Happy User')
        const username = scopedName('onb').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await page.locator('#username').fill(username)
        await expect(page.getByText('Username is available')).toBeVisible({ timeout: 15000 })
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText('Male', { exact: true }).click()
        await page.getByLabel('Pronouns (optional)').fill('he/him')
        await page.getByRole('tab', { name: 'Work prefs' }).click()
        await page.getByLabel('Experience level').selectOption('mid')
        await page.getByLabel('Availability per week').selectOption('h_10_20')
        await page.getByText('Freelance projects', { exact: true }).click()
        await page.getByText('Available', { exact: true }).first().click()
        await page.getByRole('tab', { name: 'Social' }).click()
        await page.getByLabel('GitHub URL').fill('github.com/onboarding-happy')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText('React', { exact: true }).click()
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText('Everyone', { exact: true }).click()
        await page.getByRole('button', { name: 'Complete Setup' }).click()

        await expect
            .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
            .toBe('/hub')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('legacy local draft key remains compatible', async ({ browser }) => {
        const email = FIXTURE_EMAILS.legacy
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.evaluate(() => {
            localStorage.removeItem('onboarding:draft:v2')
            localStorage.setItem('onboarding:draft:v1', JSON.stringify({
                step: 2,
                data: {
                    fullName: 'Legacy Draft User',
                    pronouns: 'they/them',
                    availabilityStatus: 'busy',
                },
                updatedAt: Date.now(),
            }))
        })
        await page.reload()

        await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10000 })
        await expect(page.getByLabel('Pronouns (optional)')).toHaveValue('they/them')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('reserved username is blocked in onboarding', async ({ browser }) => {
        const email = FIXTURE_EMAILS.reserved
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.getByLabel('Full Name').fill('Reserved Username User')
        await page.locator('#username').fill('admin')
        await expect(page.getByText('This username is reserved')).toBeVisible({ timeout: 15000 })
        await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('collision username shows taken message', async ({ browser }) => {
        const email = FIXTURE_EMAILS.collision
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.getByLabel('Full Name').fill('Collision Username User')
        await page.locator('#username').fill(EXISTING_USERNAME)
        await expect(page.getByText(/already taken/i)).toBeVisible({ timeout: 15000 })

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('username check endpoint enforces rate limit', async ({ browser }) => {
        const email = FIXTURE_EMAILS.rateLimit
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)
        await login(page, email)

        let rateLimited = false
        const configuredLimit = Number(process.env.ONBOARDING_USERNAME_CHECK_LIMIT || '30')
        const maxAttempts = Math.min(1000, Math.max(configuredLimit * 4, 120))

        for (let index = 0; index < maxAttempts; index += 1) {
            const username = `rluser${index.toString().padStart(2, '0')}`
            const response = await context.request.get(
                `/api/onboarding/username-check?username=${encodeURIComponent(username)}`,
                {
                    headers: {
                        'user-agent': 'playwright-rate-limit-test',
                    },
                }
            )
            let payload: { code?: string } = {}
            const contentType = response.headers()['content-type'] || ''
            if (contentType.includes('application/json')) {
                try {
                    payload = (await response.json()) as { code?: string }
                } catch {
                    payload = {}
                }
            }
            if (response.status() === 429 || payload.code === 'RATE_LIMITED') {
                rateLimited = true
                break
            }
        }

        expect(rateLimited, `Expected rate limit within ${maxAttempts} requests`).toBe(true)
        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('duplicate submit reuses idempotent onboarding result', async ({ browser }) => {
        const email = FIXTURE_EMAILS.idempotent
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.getByLabel('Full Name').fill('Idempotent User')
        const username = scopedName('idem').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await page.locator('#username').fill(username)
        await expect(page.getByText('Username is available')).toBeVisible({ timeout: 15000 })
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('tab', { name: 'Social' }).click()
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText('React', { exact: true }).click()
        await page.getByRole('button', { name: 'Continue' }).click()

        const submitButton = page.getByRole('button', { name: 'Complete Setup' })
        await submitButton.dblclick()

        await expect
            .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
            .toBe('/hub')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })
})
