import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, measure } from "./_helpers/perf";

test.describe("Application flow smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("open applications list, open conversation, and verify banner controls", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);
        const perf = new PerfTracker();
        await login(page);

        await measure(perf, "route.interactive.core", () =>
            page.goto("/messages", { waitUntil: "domcontentloaded" })
        );
        await page.getByRole("button", { name: "Applications" }).click();

        const applicationRows = page
            .locator("button")
            .filter({ hasText: /Applying for|Applied for/i });

        let applicationListState: "rows" | "empty" | "loading" = "loading";
        await expect
            .poll(async () => {
                const rows = await applicationRows.count();
                const emptyState = await page.getByText("No applications").count();
                if (rows > 0) return "rows" as const;
                if (emptyState > 0) return "empty" as const;
                return "loading" as const;
            }, { timeout: 15000, message: "Applications list did not resolve to rows or empty state." })
            .not.toBe("loading");

        const rowCount = await applicationRows.count();
        const emptyCount = await page.getByText("No applications").count();
        if (rowCount > 0) {
            applicationListState = "rows";
        } else if (emptyCount > 0) {
            applicationListState = "empty";
        }

        if (applicationListState === "empty") {
            await expect(page.getByText("No applications")).toBeVisible({ timeout: 5000 });
            await context.close();
            return;
        }

        await expect(applicationRows.first()).toBeVisible({ timeout: 15000 });
        const firstApplicationRow = applicationRows.first();
        await firstApplicationRow.click();

        await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
        const viewRequestLink = page.getByRole("link", { name: "View request" });
        if (await viewRequestLink.count()) {
            await expect(viewRequestLink).toBeVisible();
        }

        const editButton = page.getByRole("button", { name: "Edit" }).first();
        if (await editButton.count()) {
            await editButton.click();
            await expect(page.getByRole("heading", { name: "Edit Application" })).toBeVisible();
            await page.getByRole("button", { name: "Cancel" }).click();
            await expect(page.getByRole("heading", { name: "Edit Application" })).toHaveCount(0);
        }

        const terminalBannerText = page
            .getByText(/application was accepted|accepted this application|application was rejected|rejected this application/i)
            .first();
        if (await terminalBannerText.count()) {
            const marker = scopedName("pw-followup");
            await page.getByPlaceholder("Type a message...").fill(marker);
            await page.getByPlaceholder("Type a message...").press("Enter");
            await expect(page.getByText(marker).last()).toBeVisible({ timeout: 10000 });
            await expect(terminalBannerText).toHaveCount(0, { timeout: 10000 });
        }

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
