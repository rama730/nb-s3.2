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

test.describe("Application flow smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("open applications list, open conversation, and verify banner controls", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await login(page);

        await page.goto("/messages");
        await page.getByRole("button", { name: "Applications" }).click();

        if (await page.getByText("No applications").count()) {
            test.skip(true, "No application rows found for this account.");
            await context.close();
            return;
        }

        const firstApplicationRow = page
            .locator("button")
            .filter({ hasText: /Applying for|Applied for/i })
            .first();
        await expect(firstApplicationRow).toBeVisible();
        await firstApplicationRow.click();

        await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
        await expect(page.getByRole("link", { name: "View request" })).toBeVisible();

        const editButton = page.getByRole("button", { name: "Edit" }).first();
        if (await editButton.count()) {
            await editButton.click();
            await expect(page.getByRole("heading", { name: "Edit Application" })).toBeVisible();
            await page.getByRole("button", { name: "Cancel" }).click();
            await expect(page.getByRole("heading", { name: "Edit Application" })).toHaveCount(0);
        }

        await context.close();
    });
});
