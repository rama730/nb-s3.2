import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Public profile matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("public profile route renders for current user handle", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, { monitorConsoleTypes: ["error", "warning"] });

    await login(page);
    await page.goto("/profile");

    const handleNode = page.locator("text=/@[-_a-zA-Z0-9]+/").first();
    await expect(handleNode).toBeVisible({ timeout: 15000 });

    const handleText = ((await handleNode.textContent()) || "").trim();
    const username = handleText.replace(/^@/, "");
    expect(username.length).toBeGreaterThan(0);

    await page.goto(`/u/${encodeURIComponent(username)}`);
    await expect(page).toHaveURL(new RegExp(`/u/${username}$`));
    await expect(page.getByText(new RegExp(`@${username}`, "i")).first()).toBeVisible();
    await expect(page.getByText(/Overview|Portfolio/i).first()).toBeVisible();
    await expect(page).not.toHaveTitle(/Profile \| Edge/i);

    await page.getByRole("tab", { name: /Portfolio/i }).click();
    await expect(page).toHaveURL(new RegExp(`/u/${username}\\?tab=portfolio$`));
    await expect(page.getByRole("tabpanel", { name: /Portfolio/i })).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });

  test("public profile route canonicalizes mixed-case handles", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/profile");

    const handleNode = page.locator("text=/@[-_a-zA-Z0-9]+/").first();
    await expect(handleNode).toBeVisible({ timeout: 15000 });

    const handleText = ((await handleNode.textContent()) || "").trim();
    const username = handleText.replace(/^@/, "");
    expect(username.length).toBeGreaterThan(0);

    const mixedCaseUsername = username.replace(/[a-z]/, (value) => value.toUpperCase());
    await page.goto(`/u/${encodeURIComponent(mixedCaseUsername)}`);
    await expect(page).toHaveURL(new RegExp(`/u/${username}$`));

    await context.close();
  });
});
