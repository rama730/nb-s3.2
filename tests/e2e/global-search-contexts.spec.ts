import { expect, test } from '@playwright/test';
import { hasE2ECredentials, login } from './_helpers/auth';

test.describe('context-aware global search', () => {
    test.skip(!hasE2ECredentials, 'E2E_USER_EMAIL and E2E_USER_PASSWORD are required.');

    test.beforeEach(async ({ page }) => {
        await login(page);
    });

    test('routes Hub and Connections searches through their canonical query state', async ({ page }) => {
        await page.goto('/hub');
        await page.getByRole('button', { name: 'Search projects' }).click();
        await expect(page.getByText('Start typing to preview matching projects.')).toBeVisible();
        const hubSearch = page.getByRole('searchbox', { name: /search hub \/ projects/i });
        await expect(page.getByRole('button', { name: 'Close search' })).toHaveText('Esc');
        await expect(page.getByTestId('global-search-enter-hint')).toHaveCount(0);
        await hubSearch.fill('design systems');
        await expect(hubSearch).toHaveValue('design systems');
        await expect(page.getByRole('button', { name: 'Close search' })).toHaveCount(0);
        await expect(page.getByTestId('global-search-enter-hint')).toBeVisible();
        await expect(page.getByText('Navigate', { exact: true })).toHaveCount(0);
        await expect(page.getByText(/Search all “design systems”/)).toHaveCount(0);
        await hubSearch.press('Enter');
        await expect(page).toHaveURL(/\/hub\?(?:.*&)?q=design(?:\+|%20)systems(?:&|$)/);
        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(page).toHaveURL(/\/hub$/);
        await page.getByRole('button', { name: 'Search projects' }).click();
        const recentSearch = page.getByRole('button', { name: 'Use recent search design systems' });
        await expect(recentSearch).toBeVisible();
        await recentSearch.hover();
        const removeRecentSearch = page.getByRole('button', { name: 'Remove design systems from recent searches' });
        await expect(removeRecentSearch).toBeVisible();
        await removeRecentSearch.click();
        await expect(recentSearch).toHaveCount(0);
        await expect(removeRecentSearch).toHaveCount(0);
        await page.getByRole('button', { name: 'Close search' }).click();

        await page.goto('/people?tab=requests');
        await page.getByRole('button', { name: 'Search builders and collaborators' }).click();
        const peopleSearch = page.getByRole('searchbox', { name: /search connections \/ builders/i });
        await peopleSearch.fill('TypeScript');
        await peopleSearch.press('Enter');
        await expect(page).toHaveURL(/\/people\?(?=.*tab=discover)(?=.*q=TypeScript)/);
        await expect(page.getByRole('searchbox')).toHaveCount(0);

        await page.goto('/people?tab=network');
        await page.getByRole('button', { name: 'Search your network' }).click();
        const networkSearch = page.getByRole('searchbox', { name: /search connections \/ network/i });
        await networkSearch.fill('Ramanayudu');
        await networkSearch.press('Enter');
        await expect(page).toHaveURL(/\/people\?(?=.*tab=network)(?=.*q=Ramanayudu)/);
    });

    test('exposes a selected Hub technology and clears it without losing unrelated filters', async ({ page }) => {
        await page.goto('/hub?tech=GitHub&type=startup');
        await expect(page.getByRole('button', { name: /current query: github/i })).toBeVisible();
        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(page).toHaveURL(/\/hub\?type=startup$/);
    });

    test('delegates Messages to local search and resolves Settings intent', async ({ page }) => {
        await page.goto('/messages');
        await page.getByRole('button', { name: 'Open the dedicated Messages search' }).click();
        await expect(page.getByPlaceholder('Search messages, people, projects…')).toBeVisible();

        await page.goto('/settings');
        await page.getByRole('button', { name: 'Search settings' }).click();
        const settingsSearch = page.getByRole('searchbox', { name: /search workspace \/ settings/i });
        await settingsSearch.fill('change color theme');
        await expect(page.getByRole('option', { name: /Theme mode/ })).toBeVisible();
        await settingsSearch.press('Enter');
        await expect(page).toHaveURL(/\/settings\?tab=appearance$/);
    });
});
