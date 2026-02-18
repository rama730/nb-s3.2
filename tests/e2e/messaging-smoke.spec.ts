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

test.describe("Messaging smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("send code message and verify reply + pin actions", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await login(page);

        await page.goto("/messages");

        const firstConversation = page.locator("div.w-80 button.border-l-2").first();
        if ((await firstConversation.count()) === 0) {
            test.skip(true, "No existing conversation available for smoke run.");
        }
        await firstConversation.click();

        const composer = page.getByPlaceholder("Type a message...");
        await expect(composer).toBeVisible();

        const marker = `pw-msg-${Date.now()}`;
        const content = `optimistic ${marker}`;
        await composer.fill(content);
        await composer.press("Enter");

        const sentMessageText = page.getByText(content).last();
        await expect(sentMessageText).toBeVisible({ timeout: 15000 });
        await expect(
            page.locator("div.justify-end", { has: page.getByText(content) }).last()
        ).toBeVisible({ timeout: 2000 });
        await expect(page.locator("div.justify-start", { has: page.getByText(content) })).toHaveCount(0);

        await sentMessageText.hover();
        await page.getByLabel("Message actions").last().click();
        await page.getByRole("menuitem", { name: "Reply" }).click();
        await expect(page.getByText("Replying to")).toBeVisible();

        await sentMessageText.hover();
        await page.getByLabel("Message actions").last().click();
        const pinAction = page.getByRole("menuitem", { name: "Pin" });
        if (await pinAction.count()) {
            await pinAction.click();
            await expect(page.getByText("Pinned").first()).toBeVisible({ timeout: 10000 });
        }

        await context.close();
    });
});
