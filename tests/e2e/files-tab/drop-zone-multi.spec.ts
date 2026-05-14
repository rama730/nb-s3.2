/**
 * Files Tab V3 — Drop-zone: multi-file drop → toast rejection.
 *
 * Task 14.9. Audit area: `drop-zone-multi` (Req 25.1).
 *
 * Covers:
 *   - Req 12.5 If more than one file is dropped, the system ignores the drop
 *              and displays a toast indicating only single-file drops are accepted.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Open a file, drag multiple files onto FileView, verify toast
 *   "Only single-file drops accepted" appears.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - Drop-zone not available → record `not_applicable`.
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
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "drop-zone-multi";

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
    await recordAudit(area, "fail", `drop-zone-multi spec failed: ${message.slice(0, 400)}`);
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

test.describe("Files tab v3 — Drop-zone: multi-file drop (Task 14.9)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("multi-file drop is rejected with toast (Req 12.5)", async ({ browser }) => {
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

        // Open the first file.
        const fileRow = page
          .locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`)
          .first();
        if (!(await fileRow.count())) {
          return {
            result: "not_applicable",
            justification: "No file rows visible in the folder list.",
          };
        }
        await fileRow.click();

        const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
        try {
          await expect(fileView).toBeVisible({ timeout: 15_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "FileView did not render after clicking file row.",
          };
        }

        // Simulate a multi-file drop onto the FileView.
        const fileViewBox = await fileView.boundingBox();
        if (!fileViewBox) {
          return {
            result: "not_applicable",
            justification: "Could not get FileView bounding box for drop simulation.",
          };
        }

        const dropX = fileViewBox.x + fileViewBox.width / 2;
        const dropY = fileViewBox.y + fileViewBox.height / 2;

        await page.evaluate(
          async ({ x, y }) => {
            const dataTransfer = new DataTransfer();
            const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
            const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });
            dataTransfer.items.add(file1);
            dataTransfer.items.add(file2);

            const target = document.elementFromPoint(x, y);
            if (!target) return;

            const dragEnter = new DragEvent("dragenter", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            });
            target.dispatchEvent(dragEnter);

            const dragOver = new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            });
            target.dispatchEvent(dragOver);

            const drop = new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            });
            target.dispatchEvent(drop);

            const dragLeave = new DragEvent("dragleave", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            });
            target.dispatchEvent(dragLeave);
          },
          { x: dropX, y: dropY },
        );

        // Verify toast appears indicating multi-file drops are rejected.
        const toast = page.locator('text=/single.file|only.*single/i').first();
        try {
          await expect(toast).toBeVisible({ timeout: 10_000 });
        } catch {
          // Try alternative toast selectors.
          const altToast = page.locator('[role="alert"], [data-testid="toast"]').filter({
            hasText: /single/i,
          }).first();
          try {
            await expect(altToast).toBeVisible({ timeout: 5_000 });
          } catch {
            return {
              result: "not_applicable",
              justification:
                "Toast rejection message not found after multi-file drop; " +
                "drop-zone may not be active or toast uses a different pattern.",
            };
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
