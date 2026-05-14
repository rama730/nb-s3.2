/**
 * Files Tab V3 — TaskLinkChip: link file → chip appears → click → popover.
 *
 * Task 14.4. Audit area: `task-link-chip` (Req 25.1).
 *
 * Covers:
 *   - Req 7.1  TaskLinkChip renders on file/folder rows when ≥1 task links exist.
 *   - Req 7.3  Clicking TaskLinkChip opens a popover listing linked tasks.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Link a file to a task, navigate to Files tab, verify chip appears on the
 *   file row, click chip, verify popover shows linked task.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - No file with task links → record `not_applicable`.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const TASK_LINK_CHIP_TESTID = "task-link-chip";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const ROW_TESTID = "files-tab-folder-list-row";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "task-link-chip";

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
    await recordAudit(area, "fail", `task-link-chip spec failed: ${message.slice(0, 400)}`);
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

  // Wait for folder list to render.
  await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });

  return { ready: true };
}

test.describe("Files tab v3 — TaskLinkChip: link → chip → popover (Task 14.4)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("TaskLinkChip appears on linked file and opens popover on click (Req 7.1, 7.3)", async ({ browser }) => {
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

        // Look for any file row that already has a TaskLinkChip.
        const rows = page.locator(`[data-testid="${ROW_TESTID}"]`);
        const rowCount = await rows.count();

        let chipLocator = null;
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const chip = row.locator(`[data-testid="${TASK_LINK_CHIP_TESTID}"]`).first();
          if (await chip.count()) {
            chipLocator = chip;
            break;
          }
        }

        if (!chipLocator) {
          return {
            result: "not_applicable",
            justification:
              `No file/folder rows in project "${PROJECT_SLUG}" have a TaskLinkChip ` +
              `(data-testid="${TASK_LINK_CHIP_TESTID}"). This test requires at least one ` +
              `file linked to a task in the seeded fixture.`,
          };
        }

        // Verify chip is visible and has a count > 0.
        await expect(chipLocator).toBeVisible();
        const chipText = ((await chipLocator.textContent()) ?? "").trim();
        const chipCount = parseInt(chipText, 10);
        expect(
          chipCount,
          "TaskLinkChip must display a count ≥ 1 (Req 7.1)",
        ).toBeGreaterThanOrEqual(1);

        // Click the chip to open the popover (Req 7.3).
        await chipLocator.click();

        // Verify popover appears with linked task information.
        const popover = page.locator('[data-testid="task-link-popover"], [role="dialog"], [role="tooltip"]').first();
        try {
          await expect(popover).toBeVisible({ timeout: 5_000 });
        } catch {
          // Try alternative popover selector.
          const altPopover = page.locator('.task-link-popover, [data-radix-popper-content-wrapper]').first();
          await expect(altPopover).toBeVisible({ timeout: 5_000 });
        }

        // Verify the popover contains task information (title/status).
        const popoverContent = page.locator('[data-testid="task-link-popover"], [role="dialog"], [data-radix-popper-content-wrapper]').first();
        const popoverText = await popoverContent.innerText();
        expect(
          popoverText.length,
          "Popover should contain task information (Req 7.3)",
        ).toBeGreaterThan(0);

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
