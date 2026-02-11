import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasE2ECredentials = !!email && !!password;

async function login(page: import("@playwright/test").Page) {
    if (!hasE2ECredentials || !email || !password) {
        throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for this test.");
    }

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/hub", { timeout: 30000 });
}

test.describe("Connections smoke matrix", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("discover/network/requests tabs load and actions are stable", async ({ page }) => {
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));

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

        expect(runtimeErrors).toEqual([]);
    });
});
