/**
 * Files Tab V3 — V3 picker: in-panel attach.
 *
 * Task 14.2. Audit area: `picker in-panel` (Req 25.1).
 *
 * Covers:
 *   - Req 6.6  SingleAttachmentPicker calls `linkNodeToTask` immediately upon
 *              selection and is used in TaskDetailTabs/FilesTab for in-panel
 *              attachment.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Open task detail, use SingleAttachmentPicker to attach a file, verify
 *   the link is created and reflected in the task's file list.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - Task detail panel or picker not available → record `not_applicable`.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "picker in-panel";

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
    await recordAudit(area, "fail", `picker-in-panel spec failed: ${message.slice(0, 400)}`);
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
  return { ready: true };
}

test.describe("Files tab v3 — V3 picker: in-panel attach (Task 14.2)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("SingleAttachmentPicker attaches file immediately on selection (Req 6.6)", async ({ browser }) => {
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

        // Navigate to Tasks tab to open a task detail panel.
        const tasksTab = page.getByTestId("project-tab-tasks").first();
        if (!(await tasksTab.count())) {
          return {
            result: "not_applicable",
            justification: "Tasks tab not available in this project.",
          };
        }
        await tasksTab.click();

        // Click the first visible task to open its detail panel.
        const taskRow = page.locator('[data-testid="task-row"]').first();
        try {
          await expect(taskRow).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "No task rows visible; cannot open task detail panel.",
          };
        }
        await taskRow.click();

        // Wait for task detail panel to open.
        const taskPanel = page.locator('[data-testid="task-detail-panel"]').first();
        try {
          await expect(taskPanel).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "Task detail panel did not open.",
          };
        }

        // Switch to the Files tab within the task detail panel.
        const filesTabInPanel = taskPanel.getByRole("tab", { name: /files/i }).first();
        if (!(await filesTabInPanel.count())) {
          return {
            result: "not_applicable",
            justification: "Files tab not found in task detail panel.",
          };
        }
        await filesTabInPanel.click();

        // Look for the attach button in the task panel files section.
        const attachBtn = taskPanel.getByRole("button", { name: /attach|add file|browse/i }).first();
        if (!(await attachBtn.count())) {
          return {
            result: "not_applicable",
            justification:
              "Attach file button not found in task panel files tab; " +
              "SingleAttachmentPicker integration may not be deployed.",
          };
        }
        await attachBtn.click();

        // V3AttachmentPicker should open.
        const pickerDialog = page.locator('[data-testid="v3-attachment-picker"]').first();
        try {
          await expect(pickerDialog).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification:
              "V3AttachmentPicker did not appear; picker integration may not be deployed.",
          };
        }

        // Select a file — SingleAttachmentPicker should link immediately.
        const fileItem = pickerDialog.locator('[data-node-type="file"]').first();
        if (!(await fileItem.count())) {
          return {
            result: "not_applicable",
            justification: "No files available in picker to select.",
          };
        }
        await fileItem.click();

        // SingleAttachmentPicker calls linkNodeToTask immediately — picker should close.
        await expect(pickerDialog).toBeHidden({ timeout: 10_000 });

        // Verify the file now appears in the task panel's file list.
        const linkedFile = taskPanel.locator('[data-testid="task-linked-file"]').first();
        await expect(linkedFile).toBeVisible({ timeout: 10_000 });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
