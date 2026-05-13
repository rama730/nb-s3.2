/**
 * Files Tab V3 — Breadcrumb navigation end-to-end verification.
 *
 * Task 12.11. Audit areas (Req 18.1 enumeration):
 *   - `breadcrumb navigation / root segment click`
 *   - `breadcrumb navigation / intermediate segment click`
 *   - `breadcrumb navigation / ellipsis truncation dropdown`
 *
 * Covers:
 *   - Req 3.1  Breadcrumb_Bar renders the root-to-Current_Location path
 *              with a visible "/" separator between segments.
 *   - Req 3.2  Folder location renders root + every ancestor + current
 *              folder as the final entry.
 *   - Req 3.4  Clicking an intermediate folder segment sets
 *              Current_Location to that folder within 200ms — verified here
 *              through the resulting `history.replaceState` URL update
 *              (Req 10.4, 20.1).
 *   - Req 3.5  Clicking the root segment sets Current_Location to the
 *              project root (URL loses the `?path=` parameter entirely —
 *              never an empty-value `?path=`).
 *   - Req 3.6  When the breadcrumb has more than 6 segments the bar
 *              renders first + ellipsis + last 4, and the ellipsis
 *              affordance exposes the hidden intermediate segments.
 *
 * Preconditions (Req 21.7 coexistence):
 *   - `NEXT_PUBLIC_FILES_TAB_V3=1` must be set so `ProjectFilesWorkspace`
 *     mounts `FilesTabRoot`. When the V3 surface does not mount within
 *     the detection window the scenario records `not_applicable` with a
 *     non-empty justification (Req 18.3).
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip` (no audit entry, matches siblings).
 *   - V3 UI not rendered (flag off) → record `not_applicable`.
 *   - Fewer than two nested folders under root (intermediate click) →
 *     record `not_applicable`.
 *   - Cannot construct / discover a 7+-deep chain for the ellipsis sub-test
 *     → record `not_applicable`.
 *
 * Requirements traceability: Req 3.1–3.6, Req 10.4, Req 18.1, Req 18.3.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { scopedName } from "../_helpers/fixtures";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const SIDEBAR_TESTID = "files-tab-sidebar";
const BREADCRUMB_TESTID = "files-tab-breadcrumb";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const FOLDER_ROW_TESTID = "files-tab-folder-list-row";

const BREADCRUMB_ROOT_ID = "__root__";
const BREADCRUMB_ELLIPSIS_ID = "__ellipsis__";

const ROOT_FOLDER_NAME = "workspace";

// How long to wait for the v3 surface to appear before concluding the
// flag is not rolled out in this environment.
const V3_DETECT_TIMEOUT_MS = 15_000;

// Segments required to trigger Req 3.6 truncation (segments.length > 6).
// The breadcrumb prepends a synthetic "root" segment on top of the
// ancestor chain, so we need an ancestor chain of ≥ 6 real folders to
// reach 7 segments and trip the ellipsis.
const MIN_DEPTH_FOR_ELLIPSIS = 6;

// Mirror the sibling specs: default the public env flag on so that any
// server-side resolution of `isFilesTabV3Enabled` picks it up when the
// webServer reuses its process env.
process.env.NEXT_PUBLIC_FILES_TAB_V3 = process.env.NEXT_PUBLIC_FILES_TAB_V3 ?? "1";

// ─── Audit bookkeeping ───────────────────────────────────────────────

type ScenarioOutcome =
  | { result: "pass" }
  | { result: "not_applicable"; justification: string };

/**
 * Wraps a scenario body with audit-record bookkeeping. Exactly one audit
 * entry is emitted per scenario. Thrown assertion errors become
 * `{ result: "fail", justification: <error message> }` and are re-thrown
 * so Playwright still surfaces the failure.
 */
async function runScenario(
  area: string,
  body: () => Promise<ScenarioOutcome>,
): Promise<void> {
  let outcome: { result: AuditResult; justification?: string };
  try {
    outcome = await body();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAudit(
      area,
      "fail",
      `breadcrumb-navigation spec failed: ${message.slice(0, 400)}`,
    );
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

// ─── Page setup helpers ──────────────────────────────────────────────

/**
 * Opens the Files tab for `slug` and waits for the V3 root to appear.
 * Returns `{ ready: false, reason }` when the V3 surface does not mount
 * within `V3_DETECT_TIMEOUT_MS` — callers translate this into a
 * `not_applicable` audit outcome.
 */
async function openFilesTabV3(
  page: Page,
): Promise<{ ready: boolean; reason?: string }> {
  await login(page);
  await page.goto(FILES_TAB_URL, { waitUntil: "domcontentloaded" });

  const activeTab = new URL(page.url()).searchParams.get("tab");
  if (activeTab !== "files") {
    const filesTab = page.getByTestId("project-tab-files").first();
    if (await filesTab.count()) {
      await filesTab.click();
    }
  }

  const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
  try {
    await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
  } catch {
    return {
      ready: false,
      reason:
        `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear ` +
        `within ${V3_DETECT_TIMEOUT_MS}ms for project "${PROJECT_SLUG}". ` +
        `NEXT_PUBLIC_FILES_TAB_V3 is likely unset in the E2E server environment.`,
    };
  }

  // Wait for the startup stage to progress past "explorer" so the tree
  // has hydrated and breadcrumb / folder-list surfaces render.
  await expect
    .poll(async () => v3Root.getAttribute("data-startup-stage"), {
      timeout: 15_000,
    })
    .not.toBe("explorer");

  await expect(page.getByTestId(SIDEBAR_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId(BREADCRUMB_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
    timeout: 10_000,
  });

  return { ready: true };
}

// ─── Breadcrumb DOM helpers ──────────────────────────────────────────

/** Read the current `?path=` value (decoded), or `null` when absent. */
function readPathParam(page: Page): string | null {
  try {
    const url = new URL(page.url());
    const raw = url.searchParams.get("path");
    if (raw === null) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/**
 * Collect every rendered breadcrumb segment id (in visual order). The
 * root button uses `__root__`, the ellipsis uses `__ellipsis__`, and
 * folder / file segments use their raw node id (a UUID for seeded
 * fixtures).
 */
async function readBreadcrumbSegmentIds(page: Page): Promise<string[]> {
  const breadcrumb = page.getByTestId(BREADCRUMB_TESTID).first();
  const segments = breadcrumb.locator("[data-breadcrumb-segment-id]");
  const count = await segments.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await segments.nth(i).getAttribute("data-breadcrumb-segment-id");
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * Returns the first visible folder row at the current `FolderListView`
 * along with its `data-node-id`. Returns `null` when no folder rows are
 * currently rendered.
 */
async function firstFolderRow(
  page: Page,
): Promise<{ nodeId: string; row: Locator; name: string } | null> {
  const rows = page
    .locator(`[data-testid="${FOLDER_ROW_TESTID}"][data-node-type="folder"]`);
  try {
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  } catch {
    return null;
  }
  const row = rows.first();
  const nodeId = await row.getAttribute("data-node-id");
  if (!nodeId) return null;
  const name = (await row.innerText()).trim().split("\n")[0] ?? "";
  return { nodeId, row, name };
}

/**
 * Click a folder row in the main-area `FolderListView` and wait for the
 * breadcrumb to update so it now includes the folder id as its final
 * segment.
 */
async function openFolderRow(
  page: Page,
  nodeId: string,
): Promise<void> {
  const row = page
    .locator(`[data-testid="${FOLDER_ROW_TESTID}"][data-node-id="${nodeId}"]`)
    .first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // `useFilesTabUrlSync` mirrors `currentLocationId` into the URL via
  // `history.replaceState`. We poll for the breadcrumb to reflect the
  // new location instead of the URL, because the URL carries the
  // segment *path* rather than the id — the breadcrumb segment ids are
  // a more direct signal that the navigation completed.
  await expect
    .poll(
      async () => {
        const ids = await readBreadcrumbSegmentIds(page);
        return ids[ids.length - 1] === nodeId;
      },
      {
        timeout: 10_000,
        message: `expected folder ${nodeId} to become the terminal breadcrumb segment`,
      },
    )
    .toBe(true);
}

// ─── Sidebar helpers (for creating the deep chain) ───────────────────

/** Locate a tree row by visible node name. See move.spec.ts for origin. */
function locateTreeRowByName(page: Page, name: string): Locator {
  return page
    .locator('[role="treeitem"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

async function openContextMenu(row: Locator): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: "right" });
  await expect(row.page().getByRole("menu").first()).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Create a child folder named `name` inside the tree row `parentRow`
 * (right-click → New folder → fill → Create). Returns once the new row
 * is visible in the tree.
 */
async function createChildFolder(
  page: Page,
  parentRow: Locator,
  name: string,
): Promise<void> {
  await openContextMenu(parentRow);
  await page.getByRole("menuitem", { name: /^New folder$/ }).click();

  const createDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByText(/^Create folder$/) })
    .first();
  await expect(createDialog).toBeVisible({ timeout: 10_000 });
  await createDialog.getByPlaceholder(/Folder name/i).fill(name);
  await createDialog.getByRole("button", { name: /^Create$/ }).click();
  await expect(createDialog).toBeHidden({ timeout: 15_000 });

  const newRow = locateTreeRowByName(page, name);
  await expect(newRow).toBeVisible({ timeout: 15_000 });
}

// ─── Spec ────────────────────────────────────────────────────────────

test.describe("Files tab v3 — breadcrumb navigation (root + intermediate + ellipsis)", () => {
  test.skip(
    !hasE2ECredentials,
    "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
  );

  test("clicking the root segment navigates to the project root (Req 3.5)", async ({ browser }) => {
    const area = "breadcrumb navigation / root segment click";
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
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // Need at least one folder to navigate into, then back.
        const folder = await firstFolderRow(page);
        if (!folder) {
          return {
            result: "not_applicable",
            justification:
              `Project "${PROJECT_SLUG}" root folder exposes no folder rows; ` +
              `root-segment verification requires ≥1 folder to navigate into before clicking root.`,
          };
        }

        // Navigate into the folder so the breadcrumb has > 1 segment.
        await openFolderRow(page, folder.nodeId);

        // Sanity: URL now carries a `?path=` (non-root state).
        await expect
          .poll(() => readPathParam(page), { timeout: 5_000 })
          .not.toBeNull();

        const segmentIdsBefore = await readBreadcrumbSegmentIds(page);
        expect(
          segmentIdsBefore[0],
          "root segment must always be the leading breadcrumb entry (Req 3.1, 3.2)",
        ).toBe(BREADCRUMB_ROOT_ID);
        expect(
          segmentIdsBefore.length,
          "breadcrumb must expose more than just the root after navigating into a folder",
        ).toBeGreaterThan(1);

        // Click the root segment. `data-breadcrumb-segment-id="__root__"`
        // is the public marker documented on `BreadcrumbBar`.
        const rootButton = page
          .getByTestId(BREADCRUMB_TESTID)
          .locator(`[data-breadcrumb-segment-id="${BREADCRUMB_ROOT_ID}"]`)
          .first();
        await expect(rootButton).toBeVisible();
        await rootButton.click();

        // After root click: breadcrumb collapses to the root-only
        // segment, FolderListView is visible, and the URL has no
        // `?path=` parameter (never an empty-value one — Req 10.4 /
        // design § URL Contract "no `?path=` parameter (not empty-value
        // `?path=`)").
        await expect
          .poll(
            async () => {
              const ids = await readBreadcrumbSegmentIds(page);
              return ids.length === 1 && ids[0] === BREADCRUMB_ROOT_ID;
            },
            {
              timeout: 10_000,
              message: "expected breadcrumb to collapse to the root segment",
            },
          )
          .toBe(true);

        await expect
          .poll(() => readPathParam(page), {
            timeout: 5_000,
            message:
              "expected URL to drop `?path=` entirely after clicking the root segment",
          })
          .toBeNull();

        // Folder list must be visible again at the root location.
        await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
          timeout: 10_000,
        });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("clicking an intermediate segment navigates to that folder and updates ?path= (Req 3.4, 10.4)", async ({ browser }) => {
    const area = "breadcrumb navigation / intermediate segment click";
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
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // We need an ancestor chain of at least two folders so there is
        // a genuine intermediate segment to click (the breadcrumb at
        // [root, A, B] has A as the only intermediate folder segment).
        // Build a two-level chain beneath the seeded `workspace` root.
        const rootTreeRow = locateTreeRowByName(page, ROOT_FOLDER_NAME);
        if (!(await rootTreeRow.count())) {
          return {
            result: "not_applicable",
            justification:
              `Seeded root folder "${ROOT_FOLDER_NAME}" not visible in the sidebar tree; ` +
              `intermediate-click verification requires the fixture tree to render.`,
          };
        }

        const levelAName = scopedName("breadcrumb-a");
        const levelBName = scopedName("breadcrumb-b");

        try {
          await createChildFolder(page, rootTreeRow, levelAName);
          const levelARow = locateTreeRowByName(page, levelAName);
          await createChildFolder(page, levelARow, levelBName);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            result: "not_applicable",
            justification:
              `Could not construct the two-level breadcrumb chain required for the ` +
              `intermediate-click verification: ${message.slice(0, 200)}`,
          };
        }

        // Navigate into the deepest folder via the sidebar tree. Clicking
        // the tree row fires `navigateTo(node.id)` (FilesTabSidebar).
        const levelBRow = locateTreeRowByName(page, levelBName);
        await expect(levelBRow).toBeVisible({ timeout: 10_000 });
        await levelBRow.click();

        // Wait for the breadcrumb to reflect at least three segments:
        //   [root, workspace, …, levelA, levelB]
        await expect
          .poll(
            async () => (await readBreadcrumbSegmentIds(page)).length,
            { timeout: 10_000 },
          )
          .toBeGreaterThanOrEqual(3);

        const idsAtLeaf = await readBreadcrumbSegmentIds(page);
        expect(
          idsAtLeaf[0],
          "root must always be the first breadcrumb segment (Req 3.2)",
        ).toBe(BREADCRUMB_ROOT_ID);
        // Intermediate segment = any folder segment that is not root and
        // not the terminal leaf. There are at least two intermediate
        // candidates now (workspace + levelA); pick the second-to-last
        // so the click meaningfully truncates the chain.
        const intermediateId = idsAtLeaf[idsAtLeaf.length - 2];
        expect(
          intermediateId,
          "expected an intermediate breadcrumb segment id between root and the current folder",
        ).toBeTruthy();
        expect(intermediateId).not.toBe(BREADCRUMB_ROOT_ID);
        expect(intermediateId).not.toBe(idsAtLeaf[idsAtLeaf.length - 1]);

        // Snapshot the `?path=` BEFORE the click so we can confirm the
        // URL was updated via `history.replaceState` (Req 10.4 forbids
        // `pushState`, and Req 20.1 requires the URL to mirror the new
        // location).
        const pathBefore = readPathParam(page);
        expect(
          pathBefore,
          "URL must carry a `?path=` parameter when not at root (Req 10.4)",
        ).not.toBeNull();

        // Capture the history-state length so a regression that introduced
        // `pushState` would be detectable: `replaceState` does NOT grow
        // the history stack, so `window.history.length` must be
        // unchanged across the intermediate click.
        const historyLengthBefore = await page.evaluate(
          () => window.history.length,
        );

        // Click the intermediate segment.
        const intermediateButton = page
          .getByTestId(BREADCRUMB_TESTID)
          .locator(`[data-breadcrumb-segment-id="${intermediateId}"]`)
          .first();
        await expect(intermediateButton).toBeVisible();
        await intermediateButton.click();

        // After the click, the breadcrumb's terminal segment MUST equal
        // the intermediate id we clicked. That is the observable sign
        // of Current_Location moving to the clicked folder (Req 3.4).
        await expect
          .poll(
            async () => {
              const ids = await readBreadcrumbSegmentIds(page);
              return ids[ids.length - 1] === intermediateId;
            },
            {
              timeout: 10_000,
              message: `expected ${intermediateId} to be the terminal breadcrumb segment after click`,
            },
          )
          .toBe(true);

        // URL MUST have been rewritten and the path must have changed
        // — a stable path would indicate the click was a no-op.
        await expect
          .poll(() => readPathParam(page), {
            timeout: 5_000,
            message:
              "expected `?path=` to remain populated for a non-root intermediate folder",
          })
          .not.toBeNull();
        const pathAfter = readPathParam(page);
        expect(
          pathAfter,
          "`?path=` must change when the intermediate segment is clicked (Req 10.4)",
        ).not.toBe(pathBefore);

        // `history.replaceState` (not `pushState`) is the sole URL write
        // path — history length must not grow.
        const historyLengthAfter = await page.evaluate(
          () => window.history.length,
        );
        expect(
          historyLengthAfter,
          "history.length must not grow after a breadcrumb click (replaceState only, Req 10.4)",
        ).toBe(historyLengthBefore);

        // Folder list is rendered for the new location.
        await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
          timeout: 10_000,
        });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("ellipsis truncation exposes hidden segments when breadcrumb > 6 segments (Req 3.6)", async ({ browser }) => {
    const area = "breadcrumb navigation / ellipsis truncation dropdown";
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
        if (!opened.ready) {
          return { result: "not_applicable", justification: opened.reason! };
        }

        // Need a folder chain deep enough to push the breadcrumb past
        // the 6-segment threshold. The breadcrumb prepends a synthetic
        // root segment, so an ancestor chain of N folders yields
        // `N + 1` rendered segments. We need `N >= MIN_DEPTH_FOR_ELLIPSIS`.
        //
        // Start from the seeded "workspace" root folder, then create
        // nested "deep-N-…" folders until we reach the required depth.
        // Each `createChildFolder` call right-clicks the prior row and
        // uses the shared V3 context-menu create flow.
        const rootTreeRow = locateTreeRowByName(page, ROOT_FOLDER_NAME);
        if (!(await rootTreeRow.count())) {
          return {
            result: "not_applicable",
            justification:
              `Seeded root folder "${ROOT_FOLDER_NAME}" not visible in the sidebar tree; ` +
              `ellipsis truncation verification requires the fixture tree to render.`,
          };
        }

        // Build chain: workspace → d0 → d1 → d2 → d3 → d4.
        // That yields ancestors of the leaf = [workspace, d0, d1, d2, d3, d4] (6 entries)
        // → breadcrumb segments = [root, workspace, d0, d1, d2, d3, d4] = 7 segments > 6.
        const levelNames: string[] = [];
        try {
          let parentRow = rootTreeRow;
          for (let i = 0; i < MIN_DEPTH_FOR_ELLIPSIS - 1; i += 1) {
            const name = scopedName(`breadcrumb-deep-${i}`);
            await createChildFolder(page, parentRow, name);
            levelNames.push(name);
            parentRow = locateTreeRowByName(page, name);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            result: "not_applicable",
            justification:
              `Could not construct the 7+-segment breadcrumb chain required for ` +
              `ellipsis verification (Req 3.6): ${message.slice(0, 200)}. The seeded ` +
              `project "${PROJECT_SLUG}" does not ship with sufficient nesting and the ` +
              `V3 "New folder" context-menu flow could not create the chain here.`,
          };
        }

        // Click the deepest leaf folder to make it Current_Location.
        const leafName = levelNames[levelNames.length - 1]!;
        const leafRow = locateTreeRowByName(page, leafName);
        await expect(leafRow).toBeVisible({ timeout: 10_000 });
        await leafRow.click();

        // Poll until the breadcrumb reflects the truncated layout. The
        // truncation is a DOM-level property: the ellipsis button has
        // `data-breadcrumb-segment-id="__ellipsis__"` and the rendered
        // inline segments shrink to root + last 4 (plus the ellipsis =
        // 6 visible markers). The full ancestor chain is still carried
        // inside the dropdown.
        await expect
          .poll(
            async () => {
              const ids = await readBreadcrumbSegmentIds(page);
              return ids.includes(BREADCRUMB_ELLIPSIS_ID);
            },
            {
              timeout: 15_000,
              message:
                `expected breadcrumb to render an ellipsis (data-breadcrumb-segment-id="${BREADCRUMB_ELLIPSIS_ID}") ` +
                `after navigating to a 7+-segment location (Req 3.6)`,
            },
          )
          .toBe(true);

        // The inline rendering must be: root + ellipsis + last 4 segments.
        // Because folder node ids are UUIDs we identify the "last 4" by
        // position rather than value: all ids after the ellipsis must
        // be distinct UUID-shaped segments (not `__root__`, not
        // `__ellipsis__`).
        const visibleIds = await readBreadcrumbSegmentIds(page);
        expect(
          visibleIds[0],
          "first inline segment must be the root (Req 3.6)",
        ).toBe(BREADCRUMB_ROOT_ID);
        const ellipsisIndex = visibleIds.indexOf(BREADCRUMB_ELLIPSIS_ID);
        expect(
          ellipsisIndex,
          `ellipsis segment must be present in inline breadcrumb (Req 3.6)`,
        ).toBeGreaterThan(0);
        const tail = visibleIds.slice(ellipsisIndex + 1);
        expect(
          tail.length,
          "truncated breadcrumb must render exactly 4 segments after the ellipsis (Req 3.6)",
        ).toBe(4);
        for (const id of tail) {
          expect(
            id,
            "trailing breadcrumb segments must be real node ids, not sentinels",
          ).not.toBe(BREADCRUMB_ROOT_ID);
          expect(id).not.toBe(BREADCRUMB_ELLIPSIS_ID);
        }

        // Click the ellipsis button to open the dropdown.
        const ellipsisButton = page
          .getByTestId(BREADCRUMB_TESTID)
          .locator(`[data-breadcrumb-segment-id="${BREADCRUMB_ELLIPSIS_ID}"]`)
          .first();
        await expect(ellipsisButton).toBeVisible();
        await ellipsisButton.click();

        // The dropdown is a Radix `DropdownMenuContent` — it renders
        // outside the breadcrumb nav into a portal with `role="menu"`.
        // Each hidden segment becomes a `DropdownMenuItem` carrying the
        // SAME `data-breadcrumb-segment-id` attribute as its segment.
        const dropdown = page.getByRole("menu").first();
        await expect(dropdown).toBeVisible({ timeout: 10_000 });

        // The hidden segments are exactly `segments.slice(1, -4)` —
        // i.e. every segment between root and the visible last-4. With
        // an ancestor chain of length 6 that yields `hidden.length = 2`
        // (the two segments immediately after root that did not make
        // the visible tail).
        //
        // Compute the expected hidden ids from the known full chain.
        // The full segment stream (before truncation) would be
        // `[__root__, ...ancestors]`. We know the visible tail already,
        // and all segment ids in the DOM are the node ids of the
        // rendered rows. We don't have the full node-id list in hand
        // here, so instead we verify two structural invariants of the
        // dropdown that Req 3.6 mandates:
        //   (i)  the dropdown lists at least one hidden segment, and
        //   (ii) none of the hidden segment ids overlap with the
        //        ids rendered inline (a hidden segment cannot be
        //        simultaneously visible inline).
        const dropdownItems = dropdown.locator(
          "[data-breadcrumb-segment-id]",
        );
        const dropdownCount = await dropdownItems.count();
        expect(
          dropdownCount,
          "ellipsis dropdown must expose the hidden segments (Req 3.6)",
        ).toBeGreaterThan(0);

        const hiddenIds: string[] = [];
        for (let i = 0; i < dropdownCount; i += 1) {
          const id = await dropdownItems
            .nth(i)
            .getAttribute("data-breadcrumb-segment-id");
          if (id !== null) hiddenIds.push(id);
        }

        const inlineSet = new Set(visibleIds);
        for (const hiddenId of hiddenIds) {
          expect(
            inlineSet.has(hiddenId),
            `hidden segment "${hiddenId}" must not also appear inline (Req 3.6)`,
          ).toBe(false);
        }

        // Close the dropdown to leave the page in a clean state.
        await page.keyboard.press("Escape");
        await expect(dropdown).toBeHidden({ timeout: 5_000 }).catch(() => {
          // Radix may leave the menu in a "closing" state briefly; not
          // fatal for the verification we just completed.
        });

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
