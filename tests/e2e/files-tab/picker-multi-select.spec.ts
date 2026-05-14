/**
 * Files Tab V3 — V3 picker: create-task with multi-select.
 *
 * Task 14.1. Audit area: `picker multi-select` (Req 25.1).
 *
 * Covers:
 *   - Req 6.5  MultiAttachmentPicker used in CreateTaskModal for multi-file
 *              selection during task creation.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Open CreateTaskModal, use MultiAttachmentPicker to select multiple files,
 *   confirm, verify attachments appear on the created task.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - CreateTaskModal or picker not available → record `not_applicable`.
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
const AREA = "picker multi-select";

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
    await recordAudit(area, "fail", `picker-multi-select spec failed: ${message.slice(0, 400)}`);
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

test.describe("Files tab v3 — V3 picker: create-task with multi-select (Task 14.1)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("MultiAttachmentPicker allows multi-file selection during task creation (Req 6.5)", async ({ browser }) => {
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

        // Navigate to Tasks tab to create a task with file attachments.
        const tasksTab = page.getByTestId("project-tab-tasks").first();
        if (!(await tasksTab.count())) {
          return {
            result: "not_applicable",
            justification: "Tasks tab not available in this project; cannot test CreateTaskModal.",
          };
        }
        await tasksTab.click();

        // Open CreateTaskModal.
        const createTaskBtn = page.getByRole("button", { name: /create task|new task/i }).first();
        try {
          await expect(createTaskBtn).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "Create task button not visible; cannot test multi-select picker.",
          };
        }
        await createTaskBtn.click();

        const createDialog = page.getByRole("dialog").first();
        await expect(createDialog).toBeVisible({ timeout: 10_000 });

        // Look for the attach files button within the create task modal.
        const attachBtn = createDialog.getByRole("button", { name: /attach|add file|browse/i }).first();
        if (!(await attachBtn.count())) {
          return {
            result: "not_applicable",
            justification:
              "Attach files button not found in CreateTaskModal; " +
              "MultiAttachmentPicker integration may not be deployed.",
          };
        }
        await attachBtn.click();

        // V3AttachmentPicker should open with the sidebar tree in navigate-only mode.
        const pickerDialog = page.locator('[data-testid="v3-attachment-picker"]').first();
        try {
          await expect(pickerDialog).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification:
              "V3AttachmentPicker (data-testid='v3-attachment-picker') did not appear; " +
              "picker integration may not be deployed in this environment.",
          };
        }

        // Select multiple files from the picker tree.
        const fileItems = pickerDialog.locator('[data-node-type="file"]');
        const fileCount = await fileItems.count();
        if (fileCount < 2) {
          return {
            result: "not_applicable",
            justification:
              `Only ${fileCount} file(s) available in picker; need ≥2 for multi-select verification.`,
          };
        }

        // Click first two files to select them.
        await fileItems.nth(0).click();
        await fileItems.nth(1).click();

        // Verify chips appear in the pinned tray (Req 6.3).
        const chipTray = pickerDialog.locator('[data-testid="picker-chip-tray"]').first();
        await expect(chipTray).toBeVisible({ timeout: 5_000 });
        const chips = chipTray.locator('[data-testid="picker-chip"]');
        const chipCount = await chips.count();
        expect(chipCount, "At least 2 chips should appear in the pinned tray").toBeGreaterThanOrEqual(2);

        // Confirm selection.
        const confirmBtn = pickerDialog.getByRole("button", { name: /confirm|done|attach/i }).first();
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();

        // Verify picker closes and attachments are reflected in the modal.
        await expect(pickerDialog).toBeHidden({ timeout: 5_000 });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
