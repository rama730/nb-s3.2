import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Messages tabs matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("chats/applications/projects tabs each resolve to visible state", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto("/messages");

    await page.getByTestId("messages-tab-chats").click();
    await expect(page.getByText(/No messages yet|Search messages|Connect to start messaging/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId("messages-tab-applications").click();
    await expect(page.getByText(/No applications|Applying for|Applied for/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId("messages-tab-projects").click();
    await expect(page.getByText(/No projects|Project|Workspace/i).first()).toBeVisible({ timeout: 15000 });

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
