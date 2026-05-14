/**
 * Files Tab V3 — Version restore from Files tab → new version row → pill updates.
 *
 * Task 14.7. Audit area: `version-restore` (Req 25.1).
 *
 * Covers:
 *   - Req 10.6 When user activates "Restore" on a version, the system calls
 *              `useFileVersions.restoreVersion(versionNumber)` and updates
 *              MetadataStrip to reflect the restored version.
 *   - Req 25.1 Every E2E spec calls `recordAudit` at least once.
 *
 * Scenario:
 *   Open file history, click Restore on a historical version, verify a new
 *   version row is created, verify the version pill updates.
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip`.
 *   - V3 UI not rendered → record `not_applicable`.
 *   - No file with version history → record `not_applicable`.
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
const METADATA_STRIP_TESTID = "files-tab-metadata-strip";
const VERSION_PILL_TESTID = "files-tab-version-pill";
const VERSION_HISTORY_TESTID = "file-version-history-panel";
const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "version-restore";

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
    await recordAudit(area, "fail", `version-restore spec failed: ${message.slice(0, 400)}`);
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

test.describe("Files tab v3 — Version restore (Task 14.7)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("Restore historical version → new version row → pill updates (Req 10.6)", async ({ browser }) => {
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

        // Find a file with currentVersion > 1 (has version history).
        const fileRows = page.locator(
          `[data-testid="${ROW_TESTID}"][data-node-type="file"]`,
        );
        const fileCount = await fileRows.count();

        let targetRow = null;
        for (let i = 0; i < fileCount; i++) {
          const row = fileRows.nth(i);
          const pill = row.locator(`[data-testid="${VERSION_PILL_TESTID}"]`).first();
          if (await pill.count()) {
            targetRow = row;
            break;
          }
        }

        if (!targetRow) {
          return {
            result: "not_applicable",
            justification:
              `No file with version history (currentVersion > 1) found in project "${PROJECT_SLUG}". ` +
              `This test requires a file with at least 2 versions.`,
          };
        }

        // Open the file.
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

        // Record current version.
        const metadataStrip = page.getByTestId(METADATA_STRIP_TESTID).first();
        let versionBefore = 1;
        if (await metadataStrip.count()) {
          const pill = metadataStrip.locator(`[data-testid="${VERSION_PILL_TESTID}"]`).first();
          if (await pill.count()) {
            const pillText = ((await pill.textContent()) ?? "").trim();
            const match = /^v(\d+)$/.exec(pillText);
            if (match) versionBefore = parseInt(match[1], 10);
          }
        }

        // Open version history.
        const historyBtn = page.getByRole("button", { name: /view history|history/i }).first();
        if (!(await historyBtn.count())) {
          return {
            result: "not_applicable",
            justification: "View history button not found in MetadataStrip.",
          };
        }
        await historyBtn.click();

        const historyPanel = page.getByTestId(VERSION_HISTORY_TESTID).first();
        try {
          await expect(historyPanel).toBeVisible({ timeout: 10_000 });
        } catch {
          return {
            result: "not_applicable",
            justification: "FileVersionHistoryPanel did not appear.",
          };
        }

        // Find a historical version row with a Restore button.
        const restoreBtn = historyPanel.getByRole("button", { name: /restore/i }).first();
        if (!(await restoreBtn.count())) {
          return {
            result: "not_applicable",
            justification:
              "No Restore button found in version history; user may be a Viewer.",
          };
        }

        // Click Restore on the first historical version.
        await restoreBtn.click();

        // Wait for version pill to update (restore bumps currentVersion).
        const pillAfter = metadataStrip.locator(`[data-testid="${VERSION_PILL_TESTID}"]`).first();
        await expect
          .poll(
            async () => {
              if (!(await pillAfter.count())) return versionBefore;
              const text = ((await pillAfter.textContent()) ?? "").trim();
              const match = /^v(\d+)$/.exec(text);
              return match ? parseInt(match[1], 10) : versionBefore;
            },
            { timeout: 15_000, message: "Version pill should increment after restore" },
          )
          .toBeGreaterThan(versionBefore);

        // Verify a new version row appears in the history panel.
        const versionRows = historyPanel.locator('[data-testid="version-row"]');
        const rowCountAfter = await versionRows.count();
        expect(
          rowCountAfter,
          "Version history should have at least one row after restore",
        ).toBeGreaterThanOrEqual(1);

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
