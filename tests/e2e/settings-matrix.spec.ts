import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Settings matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("settings landing and all sub-pages load with stable controls", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const cards = [
      "settings-card-account",
      "settings-card-security",
      "settings-card-privacy",
      "settings-card-notifications",
      "settings-card-appearance",
      "settings-card-integrations",
    ];

    for (const card of cards) {
      await expect(page.getByTestId(card)).toBeVisible();
    }

    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Delete account").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    await page.getByLabel("Current password").fill("short");
    await page.locator("#new").fill("aaaa1111");
    await page.locator("#confirm").fill("bbbb1111");
    await page.getByRole("button", { name: "Update password" }).click();

    await page.goto("/settings/privacy");
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    await expect(page.getByText(/Account visibility|Connection Request Privacy|Messaging Privacy/i).first()).toBeVisible();

    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    const notificationToggle = page.locator("label[for='email']").first();
    if (await notificationToggle.count()) {
      await notificationToggle.click();
      await expect(page.getByText(/Saving\.\.\.|Preferences saved/i).first()).toBeVisible({ timeout: 15000 });
    }

    await page.goto("/settings/appearance");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    const htmlRoot = page.locator("html");
    await page.getByTestId("appearance-theme-dark").click();
    await expect(htmlRoot).toHaveClass(/dark/);
    await page.reload();
    await expect(htmlRoot).toHaveClass(/dark/);
    await page.getByTestId("appearance-theme-system").click();

    await page.goto("/settings/integrations");
    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
