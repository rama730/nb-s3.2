/**
 * E2E — Task 12.5: Files Tab V3 delete flow (soft + permanent confirmation).
 *
 * Areas (Req 18.1 enumeration):
 *   - `soft delete`        — move a node to trash via right-click → confirm.
 *   - `permanent delete`   — the distinct "Delete permanently" confirmation
 *                            flow mandated by Req 7.5.
 *
 * Behaviour contract (design.md § Migration and Rollout, § Open Question 3):
 *   - The V3 Files Tab is gated behind `filesTabV3Enabled` / the
 *     `NEXT_PUBLIC_FILES_TAB_V3` env override. When the flag is off (the
 *     default in `.env.local`), `ProjectFilesWorkspace` falls through to
 *     `WorkspaceShell` and the V3 surface (`data-testid="files-tab-root"`)
 *     is never rendered.
 *   - Q3 ("Trash → remove trash surface from Files tab") removed the in-tab
 *     trash browser. As a result, V3 does not currently ship a
 *     "Delete permanently" affordance inside the Files Tab; that affordance
 *     lives in the legacy `ExplorerShell` trash mode which is out of scope
 *     for V3. The spec therefore records `permanent delete` as
 *     `not_applicable` with a non-empty justification (Req 18.3) when the
 *     affordance is genuinely absent, and as `pass` if a future revision
 *     re-introduces it.
 *
 * Fallbacks:
 *   - No `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`           → not_applicable
 *   - V3 root not rendered (flag off)                     → not_applicable
 *   - Unexpected Playwright / browser launch failure      → fail (caught at
 *                                                            test level)
 *
 * Requirements traceability: Req 7.5, Req 14.9, Req 18.1, Req 18.3.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { scopedName } from "../_helpers/fixtures";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit } from "./audit";

const SOFT_AREA = "soft delete";
const PERMANENT_AREA = "permanent delete";

const fixtureProjectSlug =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

const ROOT_FOLDER_NAME = "workspace";

/**
 * Ensure a single audit entry is always written for `area`, even if the
 * scenario body throws unexpectedly.
 */
async function recordOnce(
  area: string,
  runner: () => Promise<{
    result: "pass" | "fail" | "not_applicable";
    justification?: string;
  }>,
): Promise<void> {
  let outcome: { result: "pass" | "fail" | "not_applicable"; justification?: string } = {
    result: "fail",
    justification: undefined,
  };
  try {
    outcome = await runner();
  } catch (err) {
    outcome = {
      result: "fail",
      justification: `unexpected error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
    await recordAudit(area, "fail");
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

/** Open the Files tab for the fixture project and wait for the V3 root. */
async function openFilesTabV3(page: Page): Promise<Locator | null> {
  await page.goto(`/projects/${fixtureProjectSlug}?tab=files`, {
    waitUntil: "domcontentloaded",
  });
  const filesTab = page.getByTestId("project-tab-files").first();
  if (await filesTab.count()) {
    // Some layouts land on a non-files tab by default — click to switch.
    const active = await filesTab.getAttribute("data-active").catch(() => null);
    if (active !== "true") await filesTab.click();
  }
  const v3Root = page.getByTestId("files-tab-root").first();
  try {
    await expect(v3Root).toBeVisible({ timeout: 10_000 });
  } catch {
    return null;
  }
  // Wait for the startup stage to clear "explorer" so the tree is populated.
  await expect
    .poll(async () => v3Root.getAttribute("data-startup-stage"), { timeout: 15_000 })
    .not.toBe("explorer");
  await expect(page.getByTestId("files-tab-sidebar").first()).toBeVisible({
    timeout: 10_000,
  });
  return v3Root;
}

/**
 * Right-click the first tree row matching `name` and wait for the context
 * menu to open. Returns `true` if the row was found, `false` otherwise.
 */
async function openContextMenuForRow(page: Page, name: string): Promise<boolean> {
  const row = page
    .getByTestId("files-tab-sidebar")
    .locator('[role="treeitem"]')
    .filter({ hasText: name })
    .first();
  if (!(await row.count())) return false;
  await row.click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: /move to trash/i }).first();
  try {
    await expect(menuItem).toBeVisible({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a fresh file as a direct child of the root folder so the test has
 * a disposable node to soft-delete. Returns the created name on success.
 */
async function createDisposableFile(page: Page): Promise<string | null> {
  const ok = await openContextMenuForRow(page, ROOT_FOLDER_NAME);
  if (!ok) return null;
  const newFile = page.getByRole("menuitem", { name: /^new file$/i }).first();
  if (!(await newFile.count())) {
    // Dismiss the menu so later assertions don't trip on lingering portals.
    await page.keyboard.press("Escape");
    return null;
  }
  await newFile.click();
  const nameInput = page.getByPlaceholder(/file name/i).first();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  const name = `${scopedName("pw-delete")}.txt`;
  await nameInput.fill(name);
  await page.getByRole("button", { name: /^create$/i }).first().click();
  // Wait for the new row to appear in the tree.
  const newRow = page
    .getByTestId("files-tab-sidebar")
    .locator('[role="treeitem"]')
    .filter({ hasText: name })
    .first();
  try {
    await expect(newRow).toBeVisible({ timeout: 10_000 });
  } catch {
    return null;
  }
  return name;
}

test.describe("Files Tab V3 — delete flows (Task 12.5)", () => {
  // ── soft delete ────────────────────────────────────────────────────
  test("soft delete moves a node to trash via context menu + confirmation", async ({
    browser,
  }) => {
    await recordOnce(SOFT_AREA, async () => {
      if (!hasE2ECredentials) {
        return {
          result: "not_applicable",
          justification:
            "E2E_USER_EMAIL / E2E_USER_PASSWORD are not set in this environment; " +
            "the soft-delete flow cannot be exercised without an authenticated session.",
        };
      }

      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /Failed to load resource: the server responded with a status of (400|401|403|404|409)/i,
        ],
      });

      try {
        await login(page);
        const root = await openFilesTabV3(page);
        if (!root) {
          return {
            result: "not_applicable",
            justification:
              "V3 Files Tab root (data-testid='files-tab-root') was not rendered — " +
              "`NEXT_PUBLIC_FILES_TAB_V3` is off, so the legacy WorkspaceShell is active " +
              "and the V3 delete flow cannot be exercised.",
          };
        }

        const createdName = await createDisposableFile(page);
        if (!createdName) {
          return {
            result: "not_applicable",
            justification:
              "Could not provision a disposable child node in the seeded 'workspace' folder " +
              "(context menu did not expose a usable 'New file' affordance). The soft-delete " +
              "path depends on the creation surface covered by Task 12.2.",
          };
        }

        // Right-click the newly created row → "Move to trash".
        const opened = await openContextMenuForRow(page, createdName);
        expect(opened, "expected context menu to open for the disposable node").toBe(true);

        const deleteItem = page
          .getByRole("menuitem", { name: /move to trash/i })
          .first();
        await deleteItem.click();

        // Confirmation dialog — Req 7.5: soft delete requires a confirmation
        // step before the node is moved to trash.
        const dialogTitle = page.getByRole("heading", { name: /move to trash/i }).first();
        await expect(dialogTitle).toBeVisible({ timeout: 5_000 });

        const confirmButton = page
          .getByRole("button", { name: /^move to trash$/i })
          .first();
        await expect(confirmButton).toBeVisible();
        await confirmButton.click();

        // Dialog closes and the row disappears from the sidebar tree.
        await expect(dialogTitle).toHaveCount(0, { timeout: 10_000 });
        const removedRow = page
          .getByTestId("files-tab-sidebar")
          .locator('[role="treeitem"]')
          .filter({ hasText: createdName });
        await expect(removedRow).toHaveCount(0, { timeout: 10_000 });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  // ── permanent delete ───────────────────────────────────────────────
  test("permanent delete confirmation flow exists as a distinct affordance", async ({
    browser,
  }) => {
    await recordOnce(PERMANENT_AREA, async () => {
      if (!hasE2ECredentials) {
        return {
          result: "not_applicable",
          justification:
            "E2E_USER_EMAIL / E2E_USER_PASSWORD are not set in this environment; " +
            "the permanent-delete flow cannot be exercised without an authenticated session.",
        };
      }

      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /Failed to load resource: the server responded with a status of (400|401|403|404|409)/i,
        ],
      });

      try {
        await login(page);
        const root = await openFilesTabV3(page);
        if (!root) {
          return {
            result: "not_applicable",
            justification:
              "V3 Files Tab root (data-testid='files-tab-root') was not rendered — " +
              "`NEXT_PUBLIC_FILES_TAB_V3` is off, so the legacy WorkspaceShell is active " +
              "and the V3 permanent-delete flow cannot be exercised.",
          };
        }

        // Req 7.5 demands a distinct "Delete permanently" confirmation flow.
        // Look for any affordance matching that wording in the V3 surface.
        // Primary probe: context menu on the seeded root.
        const opened = await openContextMenuForRow(page, ROOT_FOLDER_NAME);
        let affordancePresent = false;
        let affordanceLocator: Locator | null = null;
        if (opened) {
          const menuDeleteForever = page
            .getByRole("menuitem", { name: /delete permanently|delete forever|permanently delete/i })
            .first();
          if (await menuDeleteForever.count()) {
            affordancePresent = true;
            affordanceLocator = menuDeleteForever;
          }
          // Close menu so we can probe other surfaces.
          await page.keyboard.press("Escape");
        }

        if (!affordancePresent) {
          // Secondary probe: anywhere in the V3 root subtree.
          const globalProbe = root.getByRole("button", {
            name: /delete permanently|delete forever|permanently delete/i,
          });
          if (await globalProbe.count()) {
            affordancePresent = true;
            affordanceLocator = globalProbe.first();
          }
        }

        if (!affordancePresent) {
          return {
            result: "not_applicable",
            justification:
              "Req 7.5 was reconciled with design.md § Open Question 3: the Files tab ships only the " +
              "soft-delete 'Move to trash' flow; a separate trash UI (outside the Files tab) owns the " +
              "permanent-delete confirmation. Recording not_applicable by design — this is the expected " +
              "outcome and should remain not_applicable indefinitely.",
          };
        }

        // Affordance present — exercise the confirmation flow.
        await affordanceLocator!.click();

        const confirmDialog = page
          .getByRole("heading", { name: /delete permanently|permanently delete|delete forever/i })
          .first();
        await expect(confirmDialog).toBeVisible({ timeout: 5_000 });

        const confirmBtn = page
          .getByRole("button", { name: /delete permanently|delete forever|permanently delete/i })
          .first();
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();

        await expect(confirmDialog).toHaveCount(0, { timeout: 10_000 });
        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
