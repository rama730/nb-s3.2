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
    await expect(page.getByText("Account Details")).toBeVisible();
    await expect(page.getByText("Cache Management")).toBeVisible();
    await expect(page.getByText("Danger Zone")).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Delete account").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    await expect(page.getByText("Security Overview")).toBeVisible();
    await expect(page.getByText("Authenticator App")).toBeVisible();
    await expect(page.getByText("Password")).toBeVisible();
    await expect(page.getByText("Active Sessions")).toBeVisible();
    await expect(page.getByText("Recent Login Activity")).toBeVisible();
    await expect(page.getByText("Security Activity")).toBeVisible();

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
    await expect(page.getByRole("button", { name: "Reset to defaults" })).toBeVisible();
    await expect(page.getByText(/Saved on this device|Syncing to your account|Saved to your account|Couldn’t sync account preference/i)).toBeVisible();
    const htmlRoot = page.locator("html");
    await page.getByTestId("appearance-theme-dark").click();
    await expect(htmlRoot).toHaveClass(/dark/);
    await page.reload();
    await expect(htmlRoot).toHaveClass(/dark/);
    await page.getByTestId("appearance-accent-orchid").click();
    await expect(htmlRoot).toHaveAttribute("data-accent", "orchid");
    await page.getByTestId("appearance-density-compact").click();
    await expect(htmlRoot).toHaveAttribute("data-density", "compact");
    await page.getByTestId("appearance-reduce-motion-toggle").click();
    await expect(htmlRoot).toHaveAttribute("data-reduce-motion", "true");
    await page.getByTestId("appearance-theme-system").click();

    await page.goto("/settings/integrations");
    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
    await expect(page.getByText("Account Connections")).toBeVisible();
    await expect(page.getByText("External Services")).toBeVisible();
    await expect(page.getByText(/Account created with/i)).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
