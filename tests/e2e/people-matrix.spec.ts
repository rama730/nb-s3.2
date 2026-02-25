import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("People matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("discover/network/requests tabs and sidebar cards render", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto("/people?tab=discover");

    await expect(page.getByRole("button", { name: "Discover" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Network" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Requests" })).toBeVisible();

    await page.getByRole("button", { name: "Network" }).click();
    await expect(page.getByLabel("Search connections")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Requests" }).click();
    await expect(page.getByText(/Incoming Requests|Sent Requests|Project Applications|No pending requests/i).first()).toBeVisible({ timeout: 15000 });

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
