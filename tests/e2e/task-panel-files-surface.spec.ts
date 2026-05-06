import { expect, test } from "@playwright/test";

import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

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

  test("shows the calmer intake menu, open-with primary action, and task note flow", async ({ browser }) => {
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

    const intakeTrigger = page.getByTestId("task-files-action-menu-trigger").first();
    await expect(intakeTrigger).toBeVisible({ timeout: 15000 });
    await intakeTrigger.click();

    await expect(page.getByTestId("task-files-action-upload-file")).toBeVisible();
    await expect(page.getByTestId("task-files-action-upload-folder")).toBeVisible();
    await expect(page.getByTestId("task-files-action-attach-existing")).toBeVisible();

    await page.keyboard.press("Escape");

    const primaryOpen = page.getByTestId("open-in-ide-trigger").first();
    await expect(primaryOpen).toHaveAttribute("data-variant", "primary");
    await expect(primaryOpen).toContainText("Open with");
    await primaryOpen.click();

    const openMenu = page.getByTestId("open-in-ide-menu");
    await expect(openMenu.getByTestId("open-in-ide-cursor")).toBeVisible();
    await expect(openMenu.getByTestId("open-in-ide-vscode")).toBeVisible();
    await expect(openMenu.getByTestId("open-in-ide-workspace")).toBeVisible();
    await expect(openMenu.getByTestId("open-in-ide-download")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("task-file-row-version").first()).toBeVisible();

    const noteAdd = page.getByTestId("task-file-row-note-add");
    const noteEdit = page.getByTestId("task-file-row-note-edit");
    if ((await noteAdd.count()) > 0) {
      await noteAdd.first().click();
    } else {
      await noteEdit.first().click();
    }

    await expect(page.getByTestId("task-file-row-note-editor").first()).toBeVisible();
    await expect(page.getByTestId("task-file-row-note-save").first()).toBeVisible();

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
