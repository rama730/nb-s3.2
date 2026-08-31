import { expect, test, type Request } from "@playwright/test";

import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, measureWithTiming } from "./_helpers/perf";

const filesUrl = process.env.E2E_TASK_PANEL_FILES_URL;

test.describe("Task panel files surface", () => {
  test.skip(
    !hasE2ECredentials,
    "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
  );
  test.skip(
    !filesUrl,
    "E2E_TASK_PANEL_FILES_URL must point at a task panel route with the files tab open and at least one file attached.",
  );

  test("shows the intake menu and task file actions without an open-with button", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      monitorConsoleTypes: ["error", "warning"],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
      ],
    });

    await login(page);
    await page.goto(filesUrl as string, { waitUntil: "domcontentloaded" });

    const intakeTrigger = page
      .getByTestId("task-files-action-menu-trigger")
      .first();
    await expect(intakeTrigger).toBeVisible({ timeout: 15000 });
    await intakeTrigger.click();

    await expect(
      page.getByTestId("task-files-action-upload-file"),
    ).toBeVisible();
    await expect(
      page.getByTestId("task-files-action-upload-folder"),
    ).toBeVisible();
    await expect(
      page.getByTestId("task-files-action-attach-existing"),
    ).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("open-in-ide-trigger")).toHaveCount(0);

    const overflow = page.getByTestId("task-file-row-overflow").first();
    await overflow.click();
    await expect(page.getByText(/Version history/).first()).toBeVisible();
    const editLabel = page.getByText("Edit Label");
    if ((await editLabel.count()) > 0) {
      await editLabel.first().click();
      await expect(
        page.getByTestId("task-file-row-label-editor").first(),
      ).toBeVisible();
    }

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });

  test("reopens the cached panel without a server route navigation", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const tracker = new PerfTracker();

    await login(page);
    await page.goto(filesUrl as string, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("task-detail-panel")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Close task details" }).click();
    await expect(page.getByTestId("task-detail-panel")).toHaveCount(0);
    await expect(page).not.toHaveURL(/drawerId=/);

    let routeReloads = 0;
    const countRouteReload = (request: Request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === new URL(filesUrl as string).pathname &&
        request.headers().rsc === "1"
      ) {
        routeReloads += 1;
      }
    };
    page.on("request", countRouteReload);

    const { elapsedMs } = await measureWithTiming(async () => {
      await page.getByTestId("task-card").first().click();
      await expect(page.getByTestId("task-detail-panel")).toBeVisible();
    });
    await tracker.assertUnder("task.detail.panel.open", elapsedMs, 100);
    expect(routeReloads).toBe(0);

    const tabTiming = await measureWithTiming(async () => {
      await page.getByRole("tab", { name: /Files/ }).click();
      await expect(page.getByTestId("task-files-tab-body")).toHaveAttribute(
        "data-loading",
        "false",
      );
    });
    await tracker.assertUnder("task.detail.tab.open", tabTiming.elapsedMs, 350);

    page.off("request", countRouteReload);
    await context.close();
  });
});
