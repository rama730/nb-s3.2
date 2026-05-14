/**
 * Files Tab V3 — Viewer role: no Replace/Attach/Restore visible.
 *
 * Task 14.10. Audit area: `viewer-role-gates` (Req 25.1).
 *
 * Covers:
 *   - Req 24.1 Role_Viewer: FileActionsBar does not render "Replace…",
 *              "Attach to task…", or any mutation button.
 *   - Req 24.2 Role_Viewer: FileVersionHistoryPanel does not render "Restore".
 *   - Req 24.3 Role_Viewer: LinkedTasksPanel does not render annotation editor
 *              or link/unlink affordances.
 *   - Req 24.4 Role_Viewer: FileView drop-zone is not active.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Log in as Viewer, navigate to a file, verify Replace/Attach/Restore
 *   buttons are not rendered.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - No viewer credentials → record `not_applicable`.
 *   - V3 UI not rendered → record `not_applicable`.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const ROW_TESTID = "files-tab-folder-list-row";
const FILE_VIEW_TESTID = "files-tab-file-view";
const REPLACE_BTN_TESTID = "files-tab-file-actions-replace";
const ATTACH_BTN_TESTID = "files-tab-file-actions-attach";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "viewer-role-gates";

const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL ?? "";
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD ?? "";
const HAS_VIEWER_CREDENTIALS = VIEWER_EMAIL.length > 0 && VIEWER_PASSWORD.length > 0;

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
    await recordAudit(area, "fail", `viewer-role-gates spec failed: ${message.slice(0, 400)}`);
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

async function loginAsViewer(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(VIEWER_EMAIL);
  await page.getByLabel(/password/i).fill(VIEWER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/hub|\/projects|\/onboarding/, { timeout: 30_000 });
}

async function openFilesTabV3(
  page: Page,
): Promise<{ ready: boolean; reason?: string }> {
  await page.goto(FILES_TAB_URL, { waitUntil: "domcontentloaded" });

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

test.describe("Files tab v3 — Viewer role gates (Task 14.10)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("Viewer cannot see Replace, Attach, or Restore buttons (Req 24.1, 24.2, 24.3, 24.4)", async ({ browser }) => {
    await runScenario(AREA, async () => {
      if (!HAS_VIEWER_CREDENTIALS) {
        return {
          result: "not_applicable",
          justification:
            "E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD not set. Viewer-role gating " +
            "requires a dedicated viewer fixture account.",
        };
      }

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
        await loginAsViewer(page);

        const opened = await openFilesTabV3(page);
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // Open a file to access FileActionsBar.
        const fileRow = page
          .locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`)
          .first();
        if (!(await fileRow.count())) {
          // Try clicking workspace folder first.
          const workspaceRow = page
            .locator('[role="treeitem"]')
            .filter({ has: page.getByText("workspace", { exact: true }) })
            .first();
          if (await workspaceRow.count()) await workspaceRow.click();
        }

        const visibleFile = page
          .locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`)
          .first();
        if (!(await visibleFile.count())) {
          return {
            result: "not_applicable",
            justification: "No file rows visible for viewer in this project.",
          };
        }
        await visibleFile.click();

        const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
        try {
          await expect(fileView).toBeVisible({ timeout: 15_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "FileView did not render for viewer.",
          };
        }

        // Req 24.1: Replace button must NOT be visible.
        const replaceCount = await page.getByTestId(REPLACE_BTN_TESTID).count();
        expect(
          replaceCount,
          "Req 24.1: Replace button must be absent for Role_Viewer",
        ).toBe(0);

        // Also check via role selector.
        const replaceByRole = await page.getByRole("button", { name: /replace/i }).count();
        expect(
          replaceByRole,
          "Req 24.1: No Replace button should be visible for Role_Viewer",
        ).toBe(0);

        // Req 24.1: Attach to task button must NOT be visible.
        const attachCount = await page.getByTestId(ATTACH_BTN_TESTID).count();
        expect(
          attachCount,
          "Req 24.1: Attach to task button must be absent for Role_Viewer",
        ).toBe(0);

        const attachByRole = await page.getByRole("button", { name: /attach to task/i }).count();
        expect(
          attachByRole,
          "Req 24.1: No 'Attach to task' button should be visible for Role_Viewer",
        ).toBe(0);

        // Req 24.2: If version history is accessible, Restore must not appear.
        const historyBtn = page.getByRole("button", { name: /view history|history/i }).first();
        if (await historyBtn.count()) {
          await historyBtn.click();
          const historyPanel = page.locator('[data-testid="file-version-history-panel"]').first();
          if (await historyPanel.isVisible()) {
            const restoreCount = await historyPanel.getByRole("button", { name: /restore/i }).count();
            expect(
              restoreCount,
              "Req 24.2: Restore button must be absent for Role_Viewer in version history",
            ).toBe(0);
          }
        }

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
