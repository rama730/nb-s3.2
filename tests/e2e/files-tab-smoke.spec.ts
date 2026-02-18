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

test.describe("Files tab smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("create folder and move to trash", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await login(page);
        await page.goto("/hub");

        const firstCard = page.locator("[data-testid^='project-card-']").first();
        await expect(firstCard).toBeVisible();
        const projectHref = await firstCard.locator("a[href^='/projects/']").first().getAttribute("href");
        expect(projectHref).toBeTruthy();

        await page.goto(`${projectHref}?tab=files`);
        await expect(page.getByPlaceholder("Search files…")).toBeVisible();

        const firstFileEntry = page
            .locator("span")
            .filter({ hasText: /\.(md|txt|ts|tsx|js|jsx|json|css|html|py|sql)$/ })
            .first();
        if (await firstFileEntry.count()) {
            await firstFileEntry.click();
            const saveButton = page.getByRole("button", { name: /^Save$/ }).first();
            await expect(saveButton).toBeVisible();
            await expect(saveButton).toBeDisabled();
            await expect(page.getByText("Unsaved")).toHaveCount(0);
            await page.waitForTimeout(3500);
            await expect(saveButton).toBeDisabled();
            await expect(page.getByText("Unsaved")).toHaveCount(0);

            const readOnlyBadge = page.getByText("Read-only").first();
            if (await readOnlyBadge.count()) {
                await expect(readOnlyBadge).toBeVisible();
                await page.waitForTimeout(3500);
                await expect(readOnlyBadge).toBeVisible();
            }
        }

        const folderName = `pw-folder-${Date.now()}`;
        await page.getByTitle("New folder").click();
        await expect(page.getByRole("heading", { name: "Create folder" })).toBeVisible();
        await page.getByPlaceholder("Folder name").fill(folderName);
        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText(folderName, { exact: true }).first()).toBeVisible();

        await page.getByText(folderName, { exact: true }).first().click();
        await page.keyboard.press("Delete");
        await expect(page.getByRole("heading", { name: "Move to Trash" })).toBeVisible();
        await page.getByRole("button", { name: "Move to Trash" }).click();

        await page.getByTitle("Trash").click();
        await expect(page.getByText(folderName, { exact: true }).first()).toBeVisible();

        await context.close();
    });
});
