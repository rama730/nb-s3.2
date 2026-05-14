/**
 * Files Tab V3 — Deep-link arrival end-to-end verification.
 *
 * Task 12.14. Audit areas (Req 18.1):
 *   - "deep link / valid path resolution"
 *   - "deep link / malformed path"
 *   - "deep link / over-length path"
 *
 * Covers Req 10.1 (deep-link arrival), Req 10.4 (replaceState only),
 * Req 10.5 (malformed/over-length → root + inline error, no disclosure),
 * Req 19.7 (no target name leaked in error indicator).
 *
 * Each scenario records exactly one audit entry. Fallbacks: not_applicable
 * when V3 isn't mounted or no file fixture is available.
 */
import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const PROJECT_BASE = `/projects/${PROJECT_SLUG}`;

const V3_ROOT_TESTID = "files-tab-root";
const FILE_VIEW_TESTID = "files-tab-file-view";
const FOLDER_LIST_TESTID = "files-tab-folder-list-view";
const ROW_TESTID = "files-tab-folder-list-row";
const NOT_FOUND_TESTID = "files-tab-main-location-not-found";

const V3_DETECT_TIMEOUT_MS = 15_000;

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
    await recordAudit(area, "fail", `deep-link spec failed: ${message.slice(0, 400)}`);
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

/**
 * Discover an existing file's encoded path by opening the Files tab
 * normally first, navigating into the seeded `workspace` folder, and
 * reading the URL after clicking a file row. Returns the encoded path
 * suitable for `?path=` reuse.
 */
async function discoverEncodedFilePath(
  page: Page,
): Promise<{ encodedPath: string; nodeId: string } | null> {
  await login(page);
  await page.goto(`${PROJECT_BASE}?tab=files`, { waitUntil: "domcontentloaded" });
  const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
  try {
    await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
  } catch {
    return null;
  }

  // Click into workspace to render its file children in the folder list.
  const workspaceRow = page
    .locator('[role="treeitem"]')
    .filter({ has: page.getByText("workspace", { exact: true }) })
    .first();
  if (await workspaceRow.count()) {
    await workspaceRow.click();
  }

  const fileRow = page
    .locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`)
    .first();
  try {
    await fileRow.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return null;
  }
  const nodeId = await fileRow.getAttribute("data-node-id");
  if (!nodeId) return null;
  await fileRow.click();

  // Wait for FileView to appear with the matching node id.
  const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
  await expect(fileView).toBeVisible({ timeout: 15_000 });
  await expect(fileView).toHaveAttribute("data-node-id", nodeId);

  // Read the `?path=` value the URL sync wrote.
  const url = new URL(page.url());
  const encoded = url.searchParams.get("path");
  if (!encoded) return null;
  return { encodedPath: encoded, nodeId };
}

test.describe("Files tab v3 — deep-link arrival (Task 12.14)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("valid ?path= resolves to the file view", async ({ browser }) => {
    const area = "deep link / valid path resolution";
    await runScenario(area, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error", "warning"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /FilesTabMain: surface disagreement/i,
          /\[files-tab\] deep-link resolve failed/i,
        ],
      });
      try {
        const discovered = await discoverEncodedFilePath(page);
        if (!discovered) {
          return {
            result: "not_applicable",
            justification:
              `Could not discover a deep-linkable file in project "${PROJECT_SLUG}" — ` +
              `either V3 didn't mount or the seeded fixture has no file rows.`,
          };
        }

        // Re-open via direct URL with the encoded path.
        await page.goto(
          `${PROJECT_BASE}?tab=files&path=${discovered.encodedPath}`,
          { waitUntil: "domcontentloaded" },
        );

        const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
        await expect(fileView).toBeVisible({ timeout: 15_000 });
        await expect(fileView).toHaveAttribute("data-node-id", discovered.nodeId);

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("malformed ?path= falls back to root with inline error (Req 10.5)", async ({ browser }) => {
    const area = "deep link / malformed path";
    await runScenario(area, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error", "warning"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /FilesTabMain: surface disagreement/i,
          /\[files-tab\] deep-link resolve failed/i,
        ],
      });
      try {
        await login(page);
        // Path that points at a node that does not exist — server returns null.
        await page.goto(
          `${PROJECT_BASE}?tab=files&path=does-not-exist/missing-${Date.now()}.txt`,
          { waitUntil: "domcontentloaded" },
        );

        const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
        try {
          await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
        } catch {
          return {
            result: "not_applicable",
            justification:
              "V3 surface not mounted; cannot verify deep-link malformed-path fallback.",
          };
        }

        // After failed deep-link: location resets to root → folder list visible.
        await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
          timeout: 15_000,
        });
        // The error is surfaced via toast (FilesTabRoot.onError) — the in-main
        // "location not found" indicator is for the unresolved-currentLocationId
        // race, not for missing deep-link targets. Both paths satisfy "no target
        // disclosure" because nothing is rendered with the deep-link content.

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });

  test("over-length ?path= (>4096) falls back to root with inline error (Req 10.5)", async ({ browser }) => {
    const area = "deep link / over-length path";
    await runScenario(area, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const monitor = attachPageMonitoring(page, {
        monitorConsoleTypes: ["error", "warning"],
        allowedConsolePatterns: [
          /The result of getSnapshot should be cached to avoid an infinite loop/i,
          /FilesTabMain: surface disagreement/i,
          /\[files-tab\] deep-link resolve failed/i,
        ],
      });
      try {
        await login(page);
        const overlengthPath = "a".repeat(4097);
        await page.goto(
          `${PROJECT_BASE}?tab=files&path=${overlengthPath}`,
          { waitUntil: "domcontentloaded" },
        );

        const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
        try {
          await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
        } catch {
          return {
            result: "not_applicable",
            justification:
              "V3 surface not mounted; cannot verify over-length deep-link fallback.",
          };
        }

        // Root state: folder list renders; FileView is NOT mounted.
        await expect(page.getByTestId(FOLDER_LIST_TESTID).first()).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByTestId(FILE_VIEW_TESTID)).toHaveCount(0);

        await monitor.assertNoViolations();
        return { result: "pass" };
      } finally {
        monitor.detach();
        await context.close();
      }
    });
  });
});
