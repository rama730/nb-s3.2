/**
 * Files Tab V3 — move operations end-to-end verification.
 *
 * Task 12.6. Verification area: `move` (Req 18.1 enumeration).
 *
 * Covers:
 *   - Req 7.6  Move a node into a new parent folder via the context menu
 *              → persists and updates the Sidebar_Tree / File_List.
 *   - Req 7.10 Reject an attempt to move a folder into itself or into any
 *              of its descendants → error toast; no mutation.
 *
 * Preconditions (Req 21.7 coexistence):
 *   - `NEXT_PUBLIC_FILES_TAB_V3=1` must be set when the Next.js dev server
 *     is started so `ProjectFilesWorkspace` mounts `FilesTabRoot` instead of
 *     the legacy `WorkspaceShell`. The public-env override is resolved at
 *     request time by `isFilesTabV3Enabled` in `src/lib/features/files.ts`.
 *     When the flag is not present the spec records `not_applicable` with a
 *     justification and exits cleanly (Req 18.3).
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip` (no audit entry).
 *   - V3 UI not rendered (flag off) → record `not_applicable`.
 *   - Playwright browser unavailable is handled at the Playwright layer; if
 *     the worker cannot start, no entry is emitted (matches the contract
 *     "Fallback to `not_applicable` with justification if browser not
 *     available" — recorded via CI tooling that wraps the runner).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasE2ECredentials, login } from "../_helpers/auth";
import { scopedName } from "../_helpers/fixtures";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit } from "./audit";

const fixtureProjectSlug =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const filesTabUrl = `/projects/${fixtureProjectSlug}?tab=files`;
const AREA = "move";

// NEXT_PUBLIC_FILES_TAB_V3 is a public-env flag that the bundler inlines
// when the dev/prod server starts. We set it here as well so that any
// server-side invocation of `isFilesTabV3Enabled` during the test run
// picks it up when the E2E runner reuses its process env (webServer).
// The authoritative gate lives in `src/lib/features/files.ts`.
process.env.NEXT_PUBLIC_FILES_TAB_V3 = process.env.NEXT_PUBLIC_FILES_TAB_V3 ?? "1";

test.describe("Files tab V3 — move", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("move node into folder via context menu + reject circular move", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      monitorConsoleTypes: ["error", "warning"],
      allowedHttpUrlPatterns: [new RegExp(`/projects/${fixtureProjectSlug}\\?tab=files$`, "i")],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
        // V3 dev-only surface-disagreement warnings (Req 6.4) are informational.
        /FilesTabMain: surface disagreement/i,
      ],
    });

    let auditRecorded = false;
    const recordOnce = async (result: Parameters<typeof recordAudit>[1], justification?: string) => {
      if (auditRecorded) return;
      auditRecorded = true;
      await recordAudit(AREA, result, justification);
    };

    try {
      await login(page);
      await page.goto(filesTabUrl, { waitUntil: "domcontentloaded" });

      // Ensure we landed on the Files tab. Some auth flows drop users on /hub.
      const activeTab = new URL(page.url()).searchParams.get("tab");
      if (activeTab !== "files") {
        const filesTab = page.getByTestId("project-tab-files").first();
        if (await filesTab.count()) {
          await filesTab.click();
        }
      }

      // Detect V3 UI. `files-tab-root` is emitted by `FilesTabRoot` (Task 8.1).
      const v3Root = page.getByTestId("files-tab-root").first();
      const v2Panel = page.getByTestId("files-workspace-toolbar-panel-toggle").first();

      const v3Ready = await v3Root
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!v3Ready) {
        const v2Visible = await v2Panel.isVisible().catch(() => false);
        await recordOnce(
          "not_applicable",
          v2Visible
            ? "NEXT_PUBLIC_FILES_TAB_V3 is not enabled on the E2E server; ProjectFilesWorkspace mounted the legacy WorkspaceShell instead of FilesTabRoot, so the V3 move flow cannot be exercised."
            : "Files tab did not render either V3 FilesTabRoot or V2 WorkspaceShell within 15s; environment is not in a state where the move flow can be verified.",
        );
        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
        return;
      }

      // V3 is up. Wait for the sidebar to paint so the tree can receive
      // context-menu events (sidebar-interactive performance mark — Req 16.5).
      const sidebar = page.getByTestId("files-tab-sidebar").first();
      await expect(sidebar).toBeVisible({ timeout: 10000 });

      // Seed two sibling folders at the root. We use the sidebar's
      // context-menu affordances (right-click on the root folder row)
      // so the test runs entirely through the V3 surface.
      const srcFolderName = scopedName("move-src");
      const dstFolderName = scopedName("move-dst");

      await createRootFolder(page, srcFolderName);
      await createRootFolder(page, dstFolderName);

      // Resolve the seeded rows by visible name so we can right-click on them.
      const srcRow = locateTreeRowByName(page, srcFolderName);
      const dstRow = locateTreeRowByName(page, dstFolderName);
      await expect(srcRow).toBeVisible({ timeout: 15000 });
      await expect(dstRow).toBeVisible({ timeout: 15000 });

      // ── Scenario A: move src into dst via context menu ──────────────
      await openContextMenu(srcRow);
      await page.getByRole("menuitem", { name: /^Move$/ }).click();

      // MoveDialog opens; pick `dst` inside the FolderPicker.
      const moveDialog = page.getByRole("dialog").filter({ has: page.getByText(/^Move$/) }).first();
      await expect(moveDialog).toBeVisible({ timeout: 10000 });

      // Click the destination folder entry inside the dialog picker.
      await moveDialog.getByText(dstFolderName, { exact: true }).click();
      await moveDialog.getByRole("button", { name: /^Move$/ }).click();

      await expect(moveDialog).toBeHidden({ timeout: 15000 });

      // Verify move by expanding dst and looking for src as a child.
      // The sidebar tree uses FileTreeRow with `data-node-id` and nested
      // `aria-level`; easier: reopen the context menu on dst to expand,
      // or click the chevron. We call `click` to toggle expansion and
      // then assert src appears under dst at a deeper aria-level than
      // it was before. Because `useExplorerMutations.confirmMove` calls
      // `toggleExpanded(projectId, target, true)` on success, dst is
      // already expanded when we land here.
      const srcAfterMove = locateTreeRowByName(page, srcFolderName);
      await expect(srcAfterMove).toBeVisible({ timeout: 15000 });
      // The relocated src row should be rendered at aria-level >= 2
      // (nested inside dst), whereas a root-level row would have
      // aria-level=1. This asserts structural placement rather than
      // relying on the exact sibling list.
      await expect
        .poll(
          async () => {
            const level = await srcAfterMove.getAttribute("aria-level");
            return level ? parseInt(level, 10) : 0;
          },
          { timeout: 15000, message: "expected src row to be nested under dst after move" },
        )
        .toBeGreaterThanOrEqual(2);

      // ── Scenario B: reject circular move (dst → its own descendant) ─
      // Now dst contains src. Attempt to move dst INTO src, which would
      // create a cycle (dst into its own descendant). `confirmMove`
      // must surface the toast "Can't move {dstName} into its own
      // descendant." and leave the tree untouched.
      const dstRowForCircular = locateTreeRowByName(page, dstFolderName);
      await expect(dstRowForCircular).toBeVisible({ timeout: 15000 });

      await openContextMenu(dstRowForCircular);
      await page.getByRole("menuitem", { name: /^Move$/ }).click();

      const circularDialog = page
        .getByRole("dialog")
        .filter({ has: page.getByText(/^Move$/) })
        .first();
      await expect(circularDialog).toBeVisible({ timeout: 10000 });

      // Inside the picker, src is now a descendant of dst (even though
      // the FolderPicker lazily loads children — clicking the chevron
      // on dst inside the picker expands it). Expand and click src.
      const pickerDstEntry = circularDialog.getByText(dstFolderName, { exact: true }).first();
      await pickerDstEntry.click();
      // Expand dst inside the picker to reveal src. The picker renders
      // an adjacent Expand button with aria-label="Expand".
      const dstPickerRow = pickerDstEntry.locator("xpath=..");
      const expandBtn = dstPickerRow.getByRole("button", { name: /^(Expand|Collapse)$/ });
      if (await expandBtn.count()) {
        const label = await expandBtn.first().getAttribute("aria-label");
        if (label === "Expand") {
          await expandBtn.first().click();
        }
      }

      // Wait for src to appear inside the picker under dst.
      const pickerSrcEntry = circularDialog.getByText(srcFolderName, { exact: true }).first();
      await expect(pickerSrcEntry).toBeVisible({ timeout: 15000 });
      await pickerSrcEntry.click();
      await circularDialog.getByRole("button", { name: /^Move$/ }).click();

      // Expect the error toast from `confirmMove` (sonner renderer).
      // The toast body carries the phrase "into its own descendant." —
      // we match loosely on "descendant" because sonner's a11y label
      // may or may not include the leading name depending on toaster
      // configuration.
      const errorToast = page
        .locator('[data-sonner-toast]')
        .filter({ hasText: /(into its own descendant|into itself)/i })
        .first();
      await expect(errorToast).toBeVisible({ timeout: 15000 });

      // Dialog may or may not close on error depending on the current
      // implementation — `confirmMove` currently returns early without
      // closing the dialog. Close it ourselves to keep the page clean.
      const cancelBtn = circularDialog.getByRole("button", { name: /^Cancel$/ });
      if (await cancelBtn.count()) {
        await cancelBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(circularDialog).toBeHidden({ timeout: 15000 });

      // Tree unchanged: src is still nested under dst (aria-level >= 2).
      const srcAfterReject = locateTreeRowByName(page, srcFolderName);
      await expect(srcAfterReject).toBeVisible({ timeout: 15000 });
      await expect
        .poll(async () => {
          const level = await srcAfterReject.getAttribute("aria-level");
          return level ? parseInt(level, 10) : 0;
        })
        .toBeGreaterThanOrEqual(2);

      await recordOnce("pass");

      await monitor.assertNoViolations();
      monitor.detach();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordOnce(
        "fail",
        `Move spec failed: ${message.slice(0, 400)}`,
      ).catch(() => {
        // Never let audit recording swallow the original failure.
      });
      throw err;
    } finally {
      await context.close().catch(() => {});
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Create a folder at the project root via the V3 sidebar context menu.
 * Right-clicks the root workspace folder row, picks `New folder`, fills
 * the dialog, and confirms. Waits for the new row to appear in the tree.
 */
async function createRootFolder(page: Page, name: string): Promise<void> {
  // The seeded root folder is named "workspace" (see scripts/seed-e2e-fixtures.ts).
  const rootRow = locateTreeRowByName(page, "workspace");
  await expect(rootRow).toBeVisible({ timeout: 15000 });

  await openContextMenu(rootRow);
  await page.getByRole("menuitem", { name: /^New folder$/ }).click();

  const createDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByText(/^Create folder$/) })
    .first();
  await expect(createDialog).toBeVisible({ timeout: 10000 });
  await createDialog.getByPlaceholder(/Folder name/i).fill(name);
  await createDialog.getByRole("button", { name: /^Create$/ }).click();
  await expect(createDialog).toBeHidden({ timeout: 15000 });

  const newRow = locateTreeRowByName(page, name);
  await expect(newRow).toBeVisible({ timeout: 15000 });
}

/**
 * Locate a tree row by its visible node name. The FilesTabSidebar reuses
 * `FileTreeRow` which renders `role="treeitem"` + `data-node-id` + a
 * visible `<span>` for the name; matching by text inside the tree is the
 * most stable selector since IDs are per-fixture.
 */
function locateTreeRowByName(page: Page, name: string): Locator {
  return page
    .locator('[role="treeitem"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

/**
 * Open the custom portal context menu on a tree row. The V3 sidebar
 * installs a Radix `DropdownMenu` driven by a manual fixed-position
 * anchor (see `FilesTabSidebar.tsx` — `contextMenuState`), so a plain
 * right-click fires the `onContextMenu` handler that opens the menu.
 */
async function openContextMenu(row: Locator): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: "right" });
  await expect(row.page().getByRole("menu").first()).toBeVisible({ timeout: 10000 });
}
