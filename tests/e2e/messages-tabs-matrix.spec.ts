import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { switchMessagesTab } from "./_helpers/messages";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Messages tabs matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("chats/applications/projects tabs each resolve to visible state", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto("/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /open messages/i })).toHaveCount(0);

    await switchMessagesTab(page, "chats");
    await expect(page.getByText(/No messages yet|Search messages|Connect to start messaging|Seeded conversation/i).first()).toBeVisible({ timeout: 15000 });

    await switchMessagesTab(page, "applications");
    await expect(page.getByText(/No applications|Applying for|Applied for|Search applications/i).first()).toBeVisible({ timeout: 15000 });

    await switchMessagesTab(page, "projects");
    await expect(page.getByText(/No project groups|Project|Workspace|Search groups/i).first()).toBeVisible({ timeout: 15000 });

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
