import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Connections smoke matrix", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("discover/network/requests tabs load and actions are stable", async ({ page }) => {
        const monitor = attachPageMonitoring(page);

        await login(page);

        await page.goto("/people?tab=discover");
        await expect(page.getByRole("button", { name: "Discover" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Network" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Requests" })).toBeVisible();

        const connectButton = page.getByRole("button", { name: /^Connect$/i }).first();
        if (await connectButton.isVisible().catch(() => false)) {
            await connectButton.click();
            await expect(
                page
                    .getByRole("button")
                    .filter({ hasText: /Pending|Connected|Connect/i })
                    .first(),
            ).toBeVisible();
        }

        const dismissButton = page.getByRole("button", { name: /Dismiss/i }).first();
        if (await dismissButton.isVisible().catch(() => false)) {
            await dismissButton.click();
            await expect(page.getByText(/Suggestion hidden/i)).toBeVisible();
        }

        await page.getByRole("button", { name: /Network/ }).click();
        await expect(page.getByPlaceholder("Search your connections...")).toBeVisible();

        await page.getByRole("button", { name: /Requests/ }).click();
        await expect(
            page.getByText(/No pending connection requests|Incoming Requests|Sent Requests/i).first(),
        ).toBeVisible();

        const acceptAllButton = page.getByRole("button", { name: /Accept all/i }).first();
        const rejectAllButton = page.getByRole("button", { name: /Reject all/i }).first();
        if (await acceptAllButton.isVisible().catch(() => false)) {
            await expect(rejectAllButton).toBeVisible();
        }

        await monitor.assertNoViolations();
        monitor.detach();
    });
});
