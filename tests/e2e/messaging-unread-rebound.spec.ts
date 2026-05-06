import { expect, test } from "@playwright/test";

import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

const unreadUrl = process.env.E2E_MESSAGES_UNREAD_URL ?? "/messages";

test.describe("Messaging unread rebound", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("cleared unread badge does not reappear without a new message", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto(unreadUrl, { waitUntil: "domcontentloaded" });

    const rows = page.locator("[data-testid^='conversation-row-']");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });

    const unreadRow = rows
      .filter({ has: page.locator("span.bg-red-500") })
      .first();
    test.skip((await unreadRow.count()) === 0, "No unread conversation available for rebound check.");

    const rowTestId = await unreadRow.getAttribute("data-testid");
    if (!rowTestId) {
      throw new Error("Unread row is missing data-testid");
    }
    const conversationId = rowTestId.replace("conversation-row-", "");

    await unreadRow.click();
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();

    const selectedRow = page.getByTestId(`conversation-row-${conversationId}`);
    await expect(selectedRow).toBeVisible();
    await expect(selectedRow.locator("span.bg-red-500")).toHaveCount(0, { timeout: 10000 });

    // Hold briefly to catch delayed stale refresh rebounds.
    await page.waitForTimeout(3000);
    await expect(selectedRow.locator("span.bg-red-500")).toHaveCount(0);

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
