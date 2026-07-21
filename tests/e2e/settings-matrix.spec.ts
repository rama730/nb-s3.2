import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Settings matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("settings landing and all tabs load with stable controls", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);

    await page.goto("/settings");
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(main.getByText("Account Details").first()).toBeVisible();
    await expect(main.getByText("Cache Management").first()).toBeVisible();
    await expect(main.getByText("Danger Zone").first()).toBeVisible();

    // Test deletion wizard opens with multi-step UI
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(main.getByText("Delete Account").first()).toBeVisible();
    await expect(main.getByText("Step 1 of 5").first()).toBeVisible();
    await expect(main.getByText("Summary").first()).toBeVisible();

    // Verify data summary is shown (Step 1)
    await expect(main.getByText("Projects").first()).toBeVisible();
    await expect(main.getByText("Connections").first()).toBeVisible();

    // Navigate to Step 2 (Export)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(main.getByText("Step 2 of 5").first()).toBeVisible();
    await expect(main.getByText("Download Your Data").first()).toBeVisible();

    // Navigate to Step 3 (Transfer)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(main.getByText("Step 3 of 5").first()).toBeVisible();

    // Navigate to Step 4 (Consequences)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(main.getByText("Step 4 of 5").first()).toBeVisible();
    await expect(main.getByText("30-Day Grace Period").first()).toBeVisible();

    // Navigate to Step 5 (Confirm)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(main.getByText("Step 5 of 5").first()).toBeVisible();
    await expect(page.getByPlaceholder("Type DELETE")).toBeVisible();

    // Go back to verify Back button works
    await page.getByRole("button", { name: "Back" }).click();
    await expect(main.getByText("Step 4 of 5").first()).toBeVisible();

    // Cancel the wizard
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/settings?tab=security");
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    await expect(main.getByText("Security Overview").first()).toBeVisible();
    await expect(page.getByTestId("security-authenticator-section")).toBeVisible();
    await expect(page.getByTestId("security-password-section")).toBeVisible();
    await expect(page.getByTestId("security-active-sessions-section")).toBeVisible();
    await expect(page.getByTestId("security-login-activity-section")).toBeVisible();
    await expect(page.getByTestId("security-activity-section")).toBeVisible();

    await page.goto("/settings?tab=privacy");
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    await expect(page.getByText(/Account visibility|Connection Request Privacy|Messaging Privacy/i).first()).toBeVisible();

    await page.goto("/settings?tab=notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    const notificationToggle = page.locator("label[for='email']").first();
    if (await notificationToggle.count()) {
      await notificationToggle.click();
      await expect(page.getByText(/Saving\.\.\.|Preferences saved/i).first()).toBeVisible({ timeout: 15000 });
    }

    await page.goto("/settings?tab=appearance");
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

    await page.goto("/settings?tab=integrations");
    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
    await expect(main.getByText("Account Connections").first()).toBeVisible();
    await expect(main.getByText("External Services").first()).toBeVisible();
    await expect(main.getByText(/^Account created with$/i).first()).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
