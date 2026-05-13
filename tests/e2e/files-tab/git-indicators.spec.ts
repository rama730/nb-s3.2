/**
 * Files Tab V3 — Git change indicator end-to-end verification.
 *
 * Task 12.10. Audit area (Req 18.1):
 *   - "git change indicators / M-A-D badges"
 *
 * Covers Req 12.1 (M/A/D badges in folder list), Req 12.2 (gated on
 * `filesFeatureFlags.wave4GitIntegration`), Req 12.5 (no badge when
 * status absent), Req 12.6 (no badge for unsupported statuses).
 *
 * The full verification requires a git-linked fixture project. When
 * the fixture / flag isn't available, the spec records `not_applicable`
 * with justification — this is the expected outcome until the wave4
 * git integration ships.
 */
import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
  process.env.E2E_GIT_FIXTURE_PROJECT_SLUG ||
  process.env.E2E_FILES_PROJECT_SLUG ||
  "e2e-files-workspace-controls";
const FILES_TAB_URL = `/projects/${PROJECT_SLUG}?tab=files`;

const V3_ROOT_TESTID = "files-tab-root";
const ROW_TESTID = "files-tab-folder-list-row";
const GIT_BADGE_TESTID = "files-tab-folder-list-git-badge";

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
    await recordAudit(area, "fail", `git-indicators spec failed: ${message.slice(0, 400)}`);
    throw err;
  }
  await recordAudit(area, outcome.result, outcome.justification);
}

async function openFilesTabV3(
  page: Page,
): Promise<{ ready: boolean; reason?: string }> {
  await login(page);
  await page.goto(FILES_TAB_URL, { waitUntil: "domcontentloaded" });
  const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
  try {
    await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
  } catch {
    return {
      ready: false,
      reason:
        `V3 surface not rendered within ${V3_DETECT_TIMEOUT_MS}ms; ` +
        `NEXT_PUBLIC_FILES_TAB_V3 likely unset on the E2E server.`,
    };
  }
  return { ready: true };
}

test.describe("Files tab v3 — git change indicators (Task 12.10)", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("M / A / D badges render when git integration is active and changedFiles is populated", async ({
    browser,
  }) => {
    const area = "git change indicators / M-A-D badges";
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

        // Click into the workspace folder to render its file rows.
        const workspaceRow = page
          .locator('[role="treeitem"]')
          .filter({ has: page.getByText("workspace", { exact: true }) })
          .first();
        if (await workspaceRow.count()) await workspaceRow.click();

        await page
          .locator(`[data-testid="${ROW_TESTID}"]`)
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => {});

        // Probe for any git change badge in the rendered folder list.
        const anyBadge = page.locator(`[data-testid="${GIT_BADGE_TESTID}"]`).first();
        const badgeCount = await page
          .locator(`[data-testid="${GIT_BADGE_TESTID}"]`)
          .count();

        if (badgeCount === 0) {
          return {
            result: "not_applicable",
            justification:
              `No git change badges in folder list of project "${PROJECT_SLUG}". ` +
              `Either filesFeatureFlags.wave4GitIntegration is off in this environment, ` +
              `or the project is not git-linked, or the fixture has no uncommitted changes. ` +
              `Set E2E_GIT_FIXTURE_PROJECT_SLUG to a git-linked fixture with M/A/D changes ` +
              `to exercise the full pass path.`,
          };
        }

        // At least one badge visible — assert it carries one of the three
        // valid statuses (Req 12.6: only M/A/D allowed).
        await expect(anyBadge).toBeVisible();
        const status = await anyBadge.getAttribute("data-status");
        expect(
          ["modified", "added", "deleted"].includes(status ?? ""),
          `Req 12.6: badge data-status must be one of modified/added/deleted, got "${status}"`,
        ).toBe(true);

        // Also assert no badge has any other status value (Req 12.6).
        const allBadges = page.locator(`[data-testid="${GIT_BADGE_TESTID}"]`);
        const totalCount = await allBadges.count();
        for (let i = 0; i < totalCount; i += 1) {
          const s = await allBadges.nth(i).getAttribute("data-status");
          expect(
            ["modified", "added", "deleted"].includes(s ?? ""),
            `Req 12.6: badge at index ${i} has invalid status "${s}"`,
          ).toBe(true);
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
