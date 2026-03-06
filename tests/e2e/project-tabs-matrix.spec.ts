import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, measure } from "./_helpers/perf";

const fixtureProjectSlug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

test.describe("Project tabs matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("dashboard/sprints/tasks/analytics/files tabs render expected surfaces", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      allowedHttpUrlPatterns: [/\/projects\/e2e-files-workspace-controls\?tab=files$/i],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
        /status of 500 \(Internal Server Error\)/i,
      ],
    });
    const perf = new PerfTracker();

    await login(page);
    await measure(perf, "route.interactive.core", () => page.goto(`/projects/${fixtureProjectSlug}`));

    await expect(page.getByTestId("project-tab-dashboard")).toBeVisible();
    await expect(page.getByTestId("project-tab-sprints")).toBeVisible();
    await expect(page.getByTestId("project-tab-tasks")).toBeVisible();
    await expect(page.getByTestId("project-tab-analytics")).toBeVisible();
    await expect(page.getByTestId("project-tab-files")).toBeVisible();

    await page.getByTestId("project-tab-sprints").click();
    await expect(page.getByText(/Sprint|No Sprints Yet|Sprint planning/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId("project-tab-tasks").click();
    await expect(page.getByText(/Task|No tasks|Create task/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId("project-tab-analytics").click();
    await expect(page.getByText(/Analytics|Views|Followers|Saves/i).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId("project-tab-files").click();
    await expect(page.getByTestId("files-explorer-actions-trigger").first()).toBeVisible({ timeout: 15000 });

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
