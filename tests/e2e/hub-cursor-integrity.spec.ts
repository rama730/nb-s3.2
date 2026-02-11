import { expect, test } from '@playwright/test';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasE2ECredentials = !!email && !!password;

async function login(page: import('@playwright/test').Page) {
    if (!hasE2ECredentials || !email || !password) {
        throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for this test.');
    }

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/hub', { timeout: 30000 });
}

test.describe('Hub cursor integrity', () => {
    test.skip(!hasE2ECredentials, 'E2E_USER_EMAIL and E2E_USER_PASSWORD are required.');

    test('does not render duplicate cards across first two loads', async ({ page }) => {
        await login(page);
        await page.goto('/hub');

        await expect(page.locator('[data-project-id]').first()).toBeVisible();

        const initialIds = new Set<string>();
        for (const value of await page.locator('[data-project-id]').evaluateAll((nodes) =>
            nodes
                .map((node) => node.getAttribute('data-project-id'))
                .filter((value): value is string => Boolean(value)),
        )) {
            initialIds.add(value);
        }

        if (initialIds.size < 4) {
            test.skip(true, 'Not enough projects for pagination validation.');
        }

        const scrollContainer = page.locator('#hub-scroll-container');
        await scrollContainer.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
        });

        await page.waitForTimeout(1200);

        const allIds = new Set<string>();
        const rawAfterScroll = await page.locator('[data-project-id]').evaluateAll((nodes) =>
            nodes
                .map((node) => node.getAttribute('data-project-id'))
                .filter((value): value is string => Boolean(value)),
        );

        for (const id of rawAfterScroll) {
            allIds.add(id);
        }

        expect(allIds.size).toBeGreaterThanOrEqual(initialIds.size);
        const duplicateIds = rawAfterScroll.filter((id, idx) => rawAfterScroll.indexOf(id) !== idx);
        expect(duplicateIds).toEqual([]);
    });
});
