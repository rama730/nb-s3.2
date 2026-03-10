import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Workspace matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("all workspace tabs render and active tab persists", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto("/workspace");

    const tabs = ["overview", "tasks", "inbox", "projects", "notes", "activity"] as const;

    for (const tab of tabs) {
      const tabButton = page.getByTestId(`workspace-tab-${tab}`).first();
      await expect(tabButton).toBeVisible();
      await tabButton.click();
      await expect(tabButton).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#workspace-tab-${tab}`).first()).toBeVisible();
    }

    await page.getByTestId("workspace-tab-notes").first().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("workspace-tab-overview").first()).toHaveAttribute("aria-selected", "true");

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
