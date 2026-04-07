import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";

test.describe("Create project wizard", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("phase 1 source cards open dedicated source views", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/hub?createProject=1", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.getByRole("dialog")).toBeVisible();

    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();
    await expect(page.getByText("Create New Project")).toHaveCount(0);

    await page.getByTestId("create-project-source-card-github").click();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();
    await expect(page.getByTestId("create-project-github-manual-url")).toBeVisible();
    await expect(page.getByTestId("create-project-connect-github")).toBeVisible();
    await page.getByTestId("create-project-github-manual-url").fill("edge/tools");
    await expect(page.getByTestId("create-project-github-manual-url")).toHaveValue("https://github.com/edge/tools");
    await page.waitForTimeout(1000);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await page.getByTestId("create-project-back-to-source-grid").click();
    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toHaveCount(0);

    await page.getByTestId("create-project-source-card-upload").click();
    await expect(page.getByTestId("create-project-source-view-upload")).toBeVisible();
    await expect(page.getByTestId("create-project-upload-dropzone")).toBeVisible();

    await page.getByTestId("create-project-back-to-source-grid").click();
    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();

    await page.getByTestId("create-project-source-card-scratch").click();
    await expect(page.getByTestId("create-project-source-view-scratch")).toBeVisible();

    await context.close();
  });

  test("github connect button starts the live oauth browser flow", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/hub", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByTestId("create-project-source-card-github").click();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await page.getByTestId("create-project-connect-github").click();

    await expect
      .poll(
        async () => {
          const currentUrl = page.url();
          if (
            /github\.com\/login\/oauth\/authorize/i.test(currentUrl) ||
            /github\.com\/login\?/i.test(currentUrl) ||
            /supabase\.co\/auth\/v1\/authorize/i.test(currentUrl) ||
            /\/auth\/v1\/authorize/i.test(currentUrl)
          ) {
            return "redirected";
          }
          return currentUrl;
        },
        { timeout: 30000 }
      )
      .toBe("redirected");

    await context.close();
  });

  test("oauth callback query opens the wizard and keeps it open after url cleanup", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/hub?createProject=1&createProjectSource=github", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await expect
      .poll(async () => new URL(page.url()).searchParams.get("createProject"))
      .toBeNull();

    await page.waitForTimeout(1000);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await context.close();
  });
});
