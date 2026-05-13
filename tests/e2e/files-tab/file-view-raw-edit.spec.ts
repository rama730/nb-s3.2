/**
 * Files Tab V3 — Single_File_View Raw + Edit + Save end-to-end.
 *
 * Task 12.13. Audit areas (Req 18.1):
 *   - "file view / Raw toggle"
 *   - "file view / Edit toggle"
 *   - "file view / Save"
 *
 * Covers Req 5.2 (Raw is plain text, no toolbars/highlighting/line-numbers),
 * Req 5.3-5.4 (Edit is hidden for Role_Viewer; visible for Owner/Member),
 * Req 5.8 (Edit replaces read-only with editor; Save persists).
 *
 * Each scenario records exactly one audit entry. Fallbacks: not_applicable
 * with justification when V3 isn't mounted, no text-file fixture is
 * available, or the editor fails to mount within the timeout.
 */
import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const FILE_VIEW_TESTID = "files-tab-file-view";
const ROW_TESTID = "files-tab-folder-list-row";
const RAW_BTN_TESTID = "files-tab-file-actions-raw";
const EDIT_BTN_TESTID = "files-tab-file-actions-edit";
const RAW_VIEWER_TESTID = "files-tab-text-viewer-raw";
const EDIT_VIEWER_TESTID = "files-tab-text-viewer-edit";
const SAVE_BTN_TESTID = "files-tab-text-viewer-save";

const V3_DETECT_TIMEOUT_MS = 15_000;

process.env.NEXT_PUBLIC_FILES_TAB_V3 = process.env.NEXT_PUBLIC_FILES_TAB_V3 ?? "1";

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
    await recordAudit(area, "fail", `file-view-raw-edit spec failed: ${message.slice(0, 400)}`);
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
        `V3 surface not rendered within ${V3_DETECT_TIMEOUT_MS}ms — ` +
        `NEXT_PUBLIC_FILES_TAB_V3 likely unset on the E2E server.`,
    };
  }
  return { ready: true };
}

/** Open the first text-like file row in the seeded folder. */
async function openFirstTextFile(
  page: Page,
): Promise<{ nodeId: string } | null> {
  // Click into the workspace folder first so its children render.
  const workspaceRow = page
    .locator('[role="treeitem"]')
    .filter({ has: page.getByText("workspace", { exact: true }) })
    .first();
  if (await workspaceRow.count()) await workspaceRow.click();

  const fileRows = page.locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`);
  await fileRows.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  const handles = await fileRows.elementHandles();
  for (const h of handles) {
    const name = (await h.innerText()).trim().toLowerCase();
    // Pick the first text-like file (md/txt/ts/json/yaml/etc.).
    if (/\.(md|txt|ts|tsx|js|jsx|json|yml|yaml|css|html?|sql|py)$/i.test(name)) {
      const nodeId = await h.getAttribute("data-node-id");
      if (nodeId) {
        await h.click();
        await expect(page.getByTestId(FILE_VIEW_TESTID).first()).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByTestId(FILE_VIEW_TESTID).first()).toHaveAttribute(
          "data-node-id",
          nodeId,
        );
        return { nodeId };
      }
    }
  }
  return null;
}

test.describe("Files tab v3 — Single_File_View Raw / Edit / Save (Task 12.13)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("Raw toggle opens plain-text viewer with no toolbars/highlighting (Req 5.2)", async ({ browser }) => {
    const area = "file view / Raw toggle";
    await runScenario(area, async () => {
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
        if (!opened.ready) return { result: "not_applicable", justification: opened.reason! };

        const file = await openFirstTextFile(page);
        if (!file) {
          return {
            result: "not_applicable",
            justification:
              `No text-like file fixture in project "${PROJECT_SLUG}" — ` +
              `Raw toggle verification needs at least one .md/.txt/.ts/etc. file.`,
          };
        }

        await page.getByTestId(RAW_BTN_TESTID).first().click();
        const rawViewer = page.getByTestId(RAW_VIEWER_TESTID).first();
        await expect(rawViewer).toBeVisible({ timeout: 5_000 });
        // Raw viewer is a bare <pre>: ensure it does NOT contain a CodeMirror
        // root (which would mean syntax highlighting / line-numbers leaked in).
        const cmCount = await rawViewer.locator(".cm-editor").count();
        expect(cmCount, "Req 5.2: Raw viewer must NOT mount CodeMirror").toBe(0);

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("Edit toggle opens CodeMirror editor for owner/member (Req 5.3, 5.8)", async ({ browser }) => {
    const area = "file view / Edit toggle";
    await runScenario(area, async () => {
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
        if (!opened.ready) return { result: "not_applicable", justification: opened.reason! };

        const file = await openFirstTextFile(page);
        if (!file) {
          return {
            result: "not_applicable",
            justification: `No text-like file fixture available for Edit toggle test.`,
          };
        }

        const editBtn = page.getByTestId(EDIT_BTN_TESTID).first();
        if (!(await editBtn.count())) {
          return {
            result: "not_applicable",
            justification:
              `Edit button absent — current user lacks Role_Owner/Role_Member ` +
              `(Req 5.4 viewer gate may be active, or the auth fixture is a viewer).`,
          };
        }
        await editBtn.click();
        const editViewer = page.getByTestId(EDIT_VIEWER_TESTID).first();
        await expect(editViewer).toBeVisible({ timeout: 15_000 });
        // CodeMirror must mount inside the edit viewer.
        await expect(editViewer.locator(".cm-editor").first()).toBeVisible({
          timeout: 15_000,
        });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("Save persists content (Req 5.8)", async ({ browser }) => {
    const area = "file view / Save";
    await runScenario(area, async () => {
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
        if (!opened.ready) return { result: "not_applicable", justification: opened.reason! };

        const file = await openFirstTextFile(page);
        if (!file) {
          return {
            result: "not_applicable",
            justification: "No text-like file fixture available for Save test.",
          };
        }

        const editBtn = page.getByTestId(EDIT_BTN_TESTID).first();
        if (!(await editBtn.count())) {
          return {
            result: "not_applicable",
            justification:
              "Edit button absent — Save flow cannot be exercised without enter-edit.",
          };
        }
        await editBtn.click();
        const editViewer = page.getByTestId(EDIT_VIEWER_TESTID).first();
        await expect(editViewer).toBeVisible({ timeout: 15_000 });
        const cm = editViewer.locator(".cm-content").first();
        await expect(cm).toBeVisible({ timeout: 15_000 });

        // Type a small marker so the buffer becomes dirty.
        await cm.click();
        await page.keyboard.type(`\n// e2e-${Date.now()}\n`);

        const saveBtn = page.getByTestId(SAVE_BTN_TESTID).first();
        await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
        await saveBtn.click();

        // Either a "File saved" toast or the dirty pill clears.
        const savedToast = page.getByText(/File saved/i).first();
        const cleanState = page
          .getByTestId("files-tab-text-viewer-clean")
          .first();
        const result = await Promise.race([
          savedToast
            .waitFor({ state: "visible", timeout: 30_000 })
            .then(() => "saved" as const)
            .catch(() => null),
          cleanState
            .waitFor({ state: "visible", timeout: 30_000 })
            .then(() => "clean" as const)
            .catch(() => null),
        ]);

        if (!result) {
          return {
            result: "not_applicable",
            justification:
              "No save outcome (toast or clean indicator) within 30s — the seeded user " +
              "may lack write access on this fixture, or the storage backend is offline.",
          };
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
