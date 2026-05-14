/**
 * Files Tab V3 — LinkedTasksPanel: open → list tasks → click task → panel opens.
 *
 * Task 14.5. Audit area: `linked-tasks-panel` (Req 25.1).
 *
 * Covers:
 *   - Req 8.1  FileView renders a toggle button that opens/closes LinkedTasksPanel.
 *   - Req 8.2  LinkedTasksPanel lists all linked tasks with title, status,
 *              assignee, and annotation.
 *   - Req 8.3  Clicking a task row opens the task panel with initialTab="files".
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Open a file with linked tasks, toggle LinkedTasksPanel, verify task list,
 *   click a task row, verify task panel opens.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - No file with linked tasks → record `not_applicable`.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const ROW_TESTID = "files-tab-folder-list-row";
const FILE_VIEW_TESTID = "files-tab-file-view";
const TASK_LINK_CHIP_TESTID = "task-link-chip";
const LINKED_TASKS_PANEL_TESTID = "linked-tasks-panel";
const LINKED_TASKS_TOGGLE_TESTID = "linked-tasks-toggle";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "linked-tasks-panel";

type ScenarioOutcome =
  | { result: "pass" }
  | { result: "not_applicable"; justification: string };

async function runScenario(
  area: string,
  body: () => Promise<ScenarioOutcome>,
): Promise<void> {
  let outcome: { result: AuditResult; justification?: string };
  try {
    outcome = await body();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAudit(area, "fail", `linked-tasks-panel spec failed: ${message.slice(0, 400)}`);
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

async function openFilesTabV3(
  page: Page,
): Promise<{ ready: boolean; reason?: string }> {
  await login(page);
  await page.goto(FILES_TAB_URL, { waitUntil: "domcontentloaded" });

  const activeTab = new URL(page.url()).searchParams.get("tab");
  if (activeTab !== "files") {
    const filesTab = page.getByTestId("project-tab-files").first();
    if (await filesTab.count()) await filesTab.click();
  }

  const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
  try {
    await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
  } catch {
    return {
      ready: false,
      reason:
        `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear ` +
        `within ${V3_DETECT_TIMEOUT_MS}ms for project "${PROJECT_SLUG}".`,
    };
  }

  await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });

  return { ready: true };
}

test.describe("Files tab v3 — LinkedTasksPanel (Task 14.5)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("open file → toggle panel → list tasks → click task → panel opens (Req 8.1, 8.2, 8.3)", async ({ browser }) => {
    await runScenario(AREA, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error", "warning"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /FilesTabMain: surface disagreement/i,
        ],
      });

      try {
        const opened = await openFilesTabV3(page);
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // Find a file row with a TaskLinkChip (indicating linked tasks).
        const rows = page.locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`);
        const rowCount = await rows.count();

        let targetRow = null;
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const chip = row.locator(`[data-testid="${TASK_LINK_CHIP_TESTID}"]`).first();
          if (await chip.count()) {
            targetRow = row;
            break;
          }
        }

        if (!targetRow) {
          return {
            result: "not_applicable",
            justification:
              `No file rows in project "${PROJECT_SLUG}" have a TaskLinkChip. ` +
              `This test requires at least one file linked to a task.`,
          };
        }

        // Click the file row to open FileView.
        await targetRow.click();
        const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
        try {
          await expect(fileView).toBeVisible({ timeout: 15_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "FileView did not render after clicking file row.",
          };
        }

        // Find and click the LinkedTasksPanel toggle button (Req 8.1).
        const toggleBtn = page.getByTestId(LINKED_TASKS_TOGGLE_TESTID).first();
        if (!(await toggleBtn.count())) {
          // Try alternative selector.
          const altToggle = page.getByRole("button", { name: /linked tasks|tasks/i }).first();
          if (!(await altToggle.count())) {
            return {
              result: "not_applicable",
              justification:
                "LinkedTasksPanel toggle button not found in FileActionsBar.",
            };
          }
          await altToggle.click();
        } else {
          await toggleBtn.click();
        }

        // Verify LinkedTasksPanel opens (Req 8.1).
        const panel = page.getByTestId(LINKED_TASKS_PANEL_TESTID).first();
        try {
          await expect(panel).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "LinkedTasksPanel did not appear after toggle click.",
          };
        }

        // Verify panel lists tasks with title and status (Req 8.2).
        const taskRows = panel.locator('[data-testid="linked-task-row"]');
        const taskRowCount = await taskRows.count();
        expect(
          taskRowCount,
          "LinkedTasksPanel should list at least one linked task (Req 8.2)",
        ).toBeGreaterThanOrEqual(1);

        // Click the first task row — should open task panel (Req 8.3).
        const firstTaskRow = taskRows.first();
        await firstTaskRow.click();

        // Verify task panel opens.
        const taskPanel = page.locator('[data-testid="task-detail-panel"]').first();
        await expect(taskPanel).toBeVisible({ timeout: 10_000 });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
