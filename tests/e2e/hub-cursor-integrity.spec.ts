import { expect, test } from '@playwright/test';
import { hasE2ECredentials, login } from './_helpers/auth';
import { attachPageMonitoring } from './_helpers/monitoring';

test.describe('Hub cursor integrity', () => {
    test.skip(!hasE2ECredentials, 'E2E_USER_EMAIL and E2E_USER_PASSWORD are required.');

    test('does not render duplicate cards across first two loads', async ({ page }) => {
        const monitor = attachPageMonitoring(page);
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

        expect(initialIds.size).toBeGreaterThan(0);

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

        await monitor.assertNoViolations();
        monitor.detach();
    });
});
