import { expect, test } from "@playwright/test";
import { e2eEmail, ensureLoggedOut, hasE2ECredentials } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { scopedName } from "./_helpers/fixtures";

test.describe("Auth and landing matrix @critical", () => {
  test("landing page and auth links render", async ({ page }) => {
    const monitor = attachPageMonitoring(page);

    await page.goto("/");
    const pathname = new URL(page.url()).pathname;
    if (pathname === "/login") {
      await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
      await page.goto("/signup");
      await expect(page).toHaveURL(/\/signup$/);
      await expect(page.getByRole("button", { name: /Create account/i })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: /Get Started/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Sign In/i })).toBeVisible();
      await page.getByRole("link", { name: /Get Started/i }).click();
      await expect(page).toHaveURL(/\/signup$/);
    }

    await monitor.assertNoViolations();
    monitor.detach();
  });

  test("protected routes redirect unauthenticated users to login", async ({ page }) => {
    const monitor = attachPageMonitoring(page);

    await ensureLoggedOut(page);
    await page.goto("/hub");
    await expect(page).toHaveURL(/\/login/);

    await monitor.assertNoViolations();
    monitor.detach();
  });

  test("signup handles duplicate email with explicit error", async ({ page }) => {
    test.skip(!hasE2ECredentials || !e2eEmail, "E2E credentials required for duplicate signup validation.");
    const monitor = attachPageMonitoring(page);

    await page.goto("/signup");
    await page.getByLabel("Full Name").fill("E2E Existing User");
    await page.getByLabel("Email").fill(e2eEmail!);
    await page.getByLabel("Password").fill("Aa1234567890");

    const submitButton = page.getByRole("button", { name: /Create account|Creating account/i });
    await submitButton.click();

    await expect
      .poll(async () => (await submitButton.textContent()) || "", { timeout: 20000 })
      .not.toContain("Creating account");

    const duplicateError = page.getByText(
      /already been used to create an account|already registered|already exists/i,
    );

    await expect(duplicateError).toBeVisible({ timeout: 20000 });

    const marker = scopedName("signup-check");
    await page.getByLabel("Full Name").fill(marker);
    await expect(page.getByLabel("Full Name")).toHaveValue(marker);

    await monitor.assertNoViolations();
    monitor.detach();
  });

  test("auth callback invalid code redirects to login error", async ({ page }) => {
    const monitor = attachPageMonitoring(page, {
      allowedHttpStatuses: [400, 401, 403, 404],
    });

    await page.goto("/auth/callback?code=invalid-test-code");
    await expect(page).toHaveURL(/\/login\?error=auth-code-error/);
    await expect(
      page.getByText(/sign-in could not be completed/i),
    ).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
  });
});
