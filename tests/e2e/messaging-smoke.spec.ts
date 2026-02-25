import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, measure } from "./_helpers/perf";

test.describe("Messaging smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("send code message and verify outgoing render", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);
        const perf = new PerfTracker();
        await login(page);

        await measure(perf, "messages.ready.firstConversation", () => page.goto("/messages"));
        await page.getByRole("button", { name: "Chats" }).click();

        const conversationRows = page.locator("[data-testid^='conversation-row-']");
        const firstConversation = conversationRows.first();
        await expect
            .poll(async () => {
                const rows = await conversationRows.count();
                const empty = await page.getByText("No messages yet").count();
                return rows > 0 || empty > 0;
            }, { timeout: 15000 })
            .toBe(true);

        if (await conversationRows.count() === 0) {
            throw new Error("Messaging smoke requires at least one existing conversation in the test account.");
        }

        await expect(firstConversation).toBeVisible();
        await firstConversation.click();

        const composer = page.getByPlaceholder("Type a message...");
        await expect(composer).toBeVisible();

        const marker = scopedName("pw-msg");
        const content = `optimistic ${marker}`;
        await composer.fill(content);
        await composer.press("Enter");

        const sentMessageText = page.getByText(content).last();
        await expect(sentMessageText).toBeVisible({ timeout: 15000 });
        await expect(
            page.locator("div.justify-end", { has: page.getByText(content) }).last()
        ).toBeVisible({ timeout: 2000 });
        await expect(page.locator("div.justify-start", { has: page.getByText(content) })).toHaveCount(0);

        await expect(page.getByPlaceholder("Type a message...")).toBeVisible();

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
