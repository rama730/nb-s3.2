import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, markNavigationMetrics, measureWithTiming } from "./_helpers/perf";

const fixtureProjectSlug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const filesTabUrl = `/projects/${fixtureProjectSlug}?tab=files`;

async function ensureFilesTabRouteHealthy(page: import("@playwright/test").Page) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await page.request.get(filesTabUrl, { failOnStatusCode: false });
    const status = response.status();
    if (status < 500) {
      if (status >= 400) {
        throw new Error(`[project-tabs-matrix] Files tab preflight failed with HTTP ${status} (${response.statusText()})`);
      }
      return;
    }

    const bodySnippet = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
    console.warn(
      `[project-tabs-matrix] Files tab preflight attempt ${attempt}/${maxAttempts} returned ${status} ${response.statusText()} body="${bodySnippet}"`
    );
    if (attempt < maxAttempts) {
      await page.waitForTimeout(400 * attempt);
      continue;
    }
    throw new Error(
      `[project-tabs-matrix] Files tab preflight failed after ${maxAttempts} attempts with HTTP ${status} (${response.statusText()})`
    );
  }
}

test.describe("Project tabs matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("dashboard/sprints/tasks/analytics/files tabs render expected surfaces", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      monitorConsoleTypes: ["error", "warning"],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
      ],
    });
    const backgroundWorkspaceRequests = { presenceToken: 0, pageActions: 0 };
    const onRequest = (request: import("@playwright/test").Request) => {
      const url = request.url();
      if (url.includes("/api/realtime/presence-token")) {
        backgroundWorkspaceRequests.presenceToken += 1;
      }
      if (request.method() === "POST" && url.includes(`/projects/${fixtureProjectSlug}`)) {
        backgroundWorkspaceRequests.pageActions += 1;
      }
    };
    page.on("request", onRequest);
    const perf = new PerfTracker();

    await login(page);
    const { elapsedMs: projectShellMs } = await measureWithTiming(() =>
      page.goto(`/projects/${fixtureProjectSlug}`, { waitUntil: "domcontentloaded" })
    );
    await markNavigationMetrics(perf, page, `/projects/${fixtureProjectSlug}`);
    perf.mark("route.interactive.core", projectShellMs, `/projects/${fixtureProjectSlug}`);
    perf.mark("project.detail.shell.interactive", projectShellMs, `/projects/${fixtureProjectSlug}`);

    const headContract = await page.evaluate(() => ({
      titleCount: document.head.querySelectorAll("title").length,
      canonicalCount: document.head.querySelectorAll('link[rel="canonical"]').length,
      descriptionCount: document.head.querySelectorAll('meta[name="description"]').length,
      themeColorOwnerCount: document.head.querySelectorAll('meta[data-app-theme-color="true"]').length,
      mainCount: document.querySelectorAll("main").length,
    }));
    expect(headContract.titleCount).toBe(1);
    expect(headContract.canonicalCount).toBe(1);
    expect(headContract.descriptionCount).toBe(1);
    expect(headContract.themeColorOwnerCount).toBe(1);
    expect(headContract.mainCount).toBe(1);

    await expect(page.getByTestId("project-tab-dashboard")).toBeVisible();
    await expect(page.getByTestId("project-tab-sprints")).toBeVisible();
    await expect(page.getByTestId("project-tab-tasks")).toBeVisible();
    await expect(page.getByTestId("project-tab-analytics")).toBeVisible();
    await expect(page.getByTestId("project-tab-files")).toBeVisible();

    const switchTab = async (tabTestId: string, tabParam: string, routeLabel: string) => {
      const tab = page.getByTestId(tabTestId);
      const { elapsedMs } = await measureWithTiming(async () => {
        await tab.click();
        await expect(tab).toHaveAttribute("data-active", "true", { timeout: 15000 });
      });
      perf.mark("project.detail.tab.switch", elapsedMs, routeLabel);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("tab"), { timeout: 15000 })
        .toBe(tabParam);
    };

    await switchTab("project-tab-sprints", "sprints", "sprints");
    await expect(page.getByText(/Sprint|No Sprints Yet|Sprint planning/i).first()).toBeVisible({ timeout: 15000 });

    await switchTab("project-tab-tasks", "tasks", "tasks");
    await expect(page.getByText(/Task|No tasks|Create task/i).first()).toBeVisible({ timeout: 15000 });

    await switchTab("project-tab-analytics", "analytics", "analytics");
    await expect(page.getByText(/Analytics|Views|Followers|Saves/i).first()).toBeVisible({ timeout: 15000 });

    // Retry the server-rendered files tab route once before UI navigation; do not suppress 5xx responses.
    await ensureFilesTabRouteHealthy(page);
    const filesTab = page.getByTestId("project-tab-files");
    await filesTab.hover();
    await page.waitForTimeout(200);

    const { elapsedMs: filesTabOpenMs } = await measureWithTiming(async () => {
      await filesTab.click();
      await expect(filesTab).toHaveAttribute("data-active", "true", { timeout: 15000 });
      await expect(page.getByTestId("files-workspace-toolbar-panel-toggle").first()).toBeVisible({ timeout: 15000 });
    });
    perf.mark("project.detail.files.tab.open", filesTabOpenMs, `/projects/${fixtureProjectSlug}?tab=files`);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("tab"), { timeout: 15000 })
      .toBe("files");
    await expect(page.getByTestId("files-explorer-actions-trigger").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[role="tree"] [role="treeitem"]').first()).toBeVisible({ timeout: 15000 });

    // Let the initial files workspace bootstrap settle before we start counting
    // post-hide background traffic. The contract here is "no hidden polling",
    // not "no startup work that was already in flight while the tab opened".
    await page.waitForTimeout(1500);

    backgroundWorkspaceRequests.presenceToken = 0;
    backgroundWorkspaceRequests.pageActions = 0;
    await switchTab("project-tab-dashboard", "dashboard", "dashboard");
    await page.waitForTimeout(3000);
    expect(backgroundWorkspaceRequests.presenceToken, "Hidden Files tab should not keep polling presence tokens").toBe(0);
    expect(backgroundWorkspaceRequests.pageActions, "Hidden Files tab should not keep firing server actions").toBe(0);

    await monitor.assertNoViolations();
    monitor.detach();
    page.off("request", onRequest);
    await context.close();
  });
});
