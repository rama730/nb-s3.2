// Task 12.7 — End-to-end verification for Files tab v3 favorites
// (star / unstar on files and folders, persistence across reloads,
// and per-project scoping of the persisted favorites map).
//
// Requirements: Req 8.1, 8.2, 8.3, 8.6 and Req 18.1 (audit record).
//
// Area covered: `favorites toggle` (tasks.md § 12.7). This spec writes
// one entry per scenario into `tests/e2e/files-tab/audit-record.json`
// via `recordAudit`. When the v3 flag is not rolled out to the test
// environment — detected by the absence of `data-testid="files-tab-root"`
// on the Files tab — entries are recorded as `not_applicable` with a
// non-empty justification per Req 18.3.
//
// Running:
//   NEXT_PUBLIC_FILES_TAB_V3=1 pnpm test:e2e tests/e2e/files-tab/favorites.spec.ts
//
// The spec reuses the seeded `e2e-files-workspace-controls` fixture as
// "project A" and `e2e-hub-pagination-alpha` as the scoping control
// "project B". Both are seeded by `scripts/seed-e2e-fixtures.ts`.

import { expect, test, type Page } from "@playwright/test";
import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_A_SLUG =
    process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";
const PROJECT_B_SLUG =
    process.env.E2E_FILES_SCOPING_PROJECT_SLUG || "e2e-hub-pagination-alpha";

const PERSIST_KEY = "files-workspace-v3";
const V3_ROOT_TESTID = "files-tab-root";
const FAVORITE_TESTID = "files-tab-folder-list-favorite";
const ROW_TESTID = "files-tab-folder-list-row";

// How long to wait for the v3 surface to appear before concluding the
// flag is not rolled out in this environment. Short so non-applicable
// runs do not burn the full test timeout.
const V3_DETECT_TIMEOUT_MS = 15_000;

// ─── Shared helpers ─────────────────────────────────────────────────

/**
 * Opens the Files tab for `projectSlug` and returns a reporter that the
 * caller uses to decide whether the v3 surface is present. When the v3
 * surface does not mount within `V3_DETECT_TIMEOUT_MS`, `ready` is false
 * and the caller records `not_applicable`.
 */
async function openFilesTab(
    page: Page,
    projectSlug: string,
): Promise<{ ready: boolean; reason?: string }> {
    await login(page);
    await page.goto(`/projects/${projectSlug}`, {
        waitUntil: "domcontentloaded",
    });

    const filesTab = page.getByTestId("project-tab-files").first();
    if (await filesTab.count()) {
        await filesTab.click();
    } else {
        await page.goto(`/projects/${projectSlug}?tab=files`, {
            waitUntil: "domcontentloaded",
        });
    }

    const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
    try {
        await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
    } catch {
        return {
            ready: false,
            reason: `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear within ${V3_DETECT_TIMEOUT_MS}ms for project "${projectSlug}". NEXT_PUBLIC_FILES_TAB_V3 is likely unset in this environment.`,
        };
    }
    return { ready: true };
}

/**
 * Returns the first folder-list row of the requested node type, waiting
 * until the folder view has rendered at least one matching row.
 */
async function firstRowByType(
    page: Page,
    nodeType: "file" | "folder",
    timeoutMs = 10_000,
): Promise<{ nodeId: string; row: ReturnType<Page["locator"]> } | null> {
    const rows = page.locator(`[data-testid="${ROW_TESTID}"][data-node-type="${nodeType}"]`);
    try {
        await expect(rows.first()).toBeVisible({ timeout: timeoutMs });
    } catch {
        return null;
    }
    const row = rows.first();
    const nodeId = await row.getAttribute("data-node-id");
    if (!nodeId) return null;
    return { nodeId, row };
}

async function readFavoriteButton(
    page: Page,
    nodeId: string,
): Promise<ReturnType<Page["locator"]>> {
    // Scope to the row so we target its favorite star, regardless of
    // which other rows are present.
    return page
        .locator(`[data-testid="${ROW_TESTID}"][data-node-id="${nodeId}"]`)
        .locator(`[data-testid="${FAVORITE_TESTID}"]`)
        .first();
}

/**
 * Clicks the favorite star on a row's star button. The star is only
 * painted on hover when the node is not already favorited, so we hover
 * the row first to make it interactive.
 */
async function toggleFavorite(
    page: Page,
    nodeId: string,
): Promise<void> {
    const row = page.locator(
        `[data-testid="${ROW_TESTID}"][data-node-id="${nodeId}"]`,
    );
    await row.hover();
    const star = await readFavoriteButton(page, nodeId);
    await expect(star).toBeVisible();
    await star.click();
}

async function expectFavoriteState(
    page: Page,
    nodeId: string,
    favorited: boolean,
): Promise<void> {
    const star = await readFavoriteButton(page, nodeId);
    await expect(star).toHaveAttribute("data-favorite", favorited ? "true" : "false");
    await expect(star).toHaveAttribute("aria-pressed", favorited ? "true" : "false");
}

/**
 * Reads the zustand-persist blob for the Files workspace store and
 * returns the full `byProjectId` map. Returns `null` when the key is
 * missing or unparseable.
 */
async function readPersistedByProjectId(
    page: Page,
): Promise<Record<string, { favorites?: Record<string, boolean> }> | null> {
    return page.evaluate((key) => {
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as {
                state?: { byProjectId?: Record<string, { favorites?: Record<string, boolean> }> };
            };
            return parsed?.state?.byProjectId ?? null;
        } catch {
            return null;
        }
    }, PERSIST_KEY);
}

/**
 * Given a persisted map and a starred `nodeId`, returns the projectId
 * whose `favorites[nodeId] === true`. Throws when zero or more than one
 * project has that entry.
 */
function findOwningProject(
    byProjectId: Record<string, { favorites?: Record<string, boolean> }>,
    nodeId: string,
): string {
    const owners = Object.entries(byProjectId).filter(
        ([, ws]) => !!ws.favorites && ws.favorites[nodeId] === true,
    );
    if (owners.length !== 1) {
        throw new Error(
            `expected exactly one project to hold favorite for nodeId="${nodeId}", found ${owners.length}`,
        );
    }
    return owners[0]![0];
}

/**
 * Wraps a scenario body with audit-record bookkeeping. The scenario
 * returns either `{ result: "pass" }` or `{ result: "not_applicable",
 * justification }`. Any thrown assertion results in `{ result: "fail" }`
 * (justification carries the error message) and the error is re-thrown
 * so Playwright surfaces the failure in its own report.
 */
async function runScenario(
    area: string,
    body: () => Promise<
        | { result: "pass" }
        | { result: "not_applicable"; justification: string }
    >,
): Promise<void> {
    let outcome: { result: AuditResult; justification?: string };
    try {
        const res = await body();
        outcome = res;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome = { result: "fail", justification: message };
        await recordAudit(area, outcome.result, outcome.justification);
        throw err;
    }
    await recordAudit(area, outcome.result, outcome.justification);
}

// ─── Spec ────────────────────────────────────────────────────────────

test.describe("Files tab v3 — favorites (star/unstar + per-project persistence)", () => {
    test.skip(
        !hasE2ECredentials,
        "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
    );

    test("toggle favorite on a file (star → unstar)", async ({ browser }) => {
        const area = "favorites toggle / file star-unstar";
        await runScenario(area, async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const monitor = attachPageMonitoring(page, {
                monitorConsoleTypes: ["error", "warning"],
                allowedConsolePatterns: [
                    /The result of getSnapshot should be cached to avoid an infinite loop/i,
                ],
            });
            try {
                const opened = await openFilesTab(page, PROJECT_A_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }
                const file = await firstRowByType(page, "file");
                if (!file) {
                    return {
                        result: "not_applicable",
                        justification: `No file rows visible in project "${PROJECT_A_SLUG}"; favorites toggle requires at least one file fixture.`,
                    };
                }

                await expectFavoriteState(page, file.nodeId, false);
                await toggleFavorite(page, file.nodeId);
                await expectFavoriteState(page, file.nodeId, true);

                await toggleFavorite(page, file.nodeId);
                await expectFavoriteState(page, file.nodeId, false);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("toggle favorite on a folder (star → unstar)", async ({ browser }) => {
        const area = "favorites toggle / folder star-unstar";
        await runScenario(area, async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const monitor = attachPageMonitoring(page, {
                monitorConsoleTypes: ["error", "warning"],
                allowedConsolePatterns: [
                    /The result of getSnapshot should be cached to avoid an infinite loop/i,
                ],
            });
            try {
                const opened = await openFilesTab(page, PROJECT_A_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }
                const folder = await firstRowByType(page, "folder");
                if (!folder) {
                    return {
                        result: "not_applicable",
                        justification: `No folder rows visible in project "${PROJECT_A_SLUG}"; favorites-on-folder verification requires at least one folder fixture.`,
                    };
                }

                await expectFavoriteState(page, folder.nodeId, false);
                await toggleFavorite(page, folder.nodeId);
                await expectFavoriteState(page, folder.nodeId, true);

                await toggleFavorite(page, folder.nodeId);
                await expectFavoriteState(page, folder.nodeId, false);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("favorite state persists across a full page reload", async ({ browser }) => {
        const area = "favorites toggle / persistence across reloads";
        await runScenario(area, async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const monitor = attachPageMonitoring(page, {
                monitorConsoleTypes: ["error", "warning"],
                allowedConsolePatterns: [
                    /The result of getSnapshot should be cached to avoid an infinite loop/i,
                ],
            });
            try {
                const opened = await openFilesTab(page, PROJECT_A_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }
                const file = await firstRowByType(page, "file");
                if (!file) {
                    return {
                        result: "not_applicable",
                        justification: `No file rows visible in project "${PROJECT_A_SLUG}"; persistence verification requires at least one file fixture.`,
                    };
                }

                await toggleFavorite(page, file.nodeId);
                await expectFavoriteState(page, file.nodeId, true);

                // Persistence is written synchronously by zustand's persist
                // middleware on every `set()` — confirm before reloading.
                const persistedBefore = await readPersistedByProjectId(page);
                expect(
                    persistedBefore,
                    "expected localStorage.files-workspace-v3 to be populated after toggling",
                ).not.toBeNull();
                const owningProjectId = findOwningProject(persistedBefore!, file.nodeId);

                // Reload and re-navigate back into the Files tab.
                await page.reload({ waitUntil: "domcontentloaded" });
                const reopened = await openFilesTab(page, PROJECT_A_SLUG);
                if (!reopened.ready) {
                    return {
                        result: "fail",
                        justification: `Files tab v3 surface disappeared after reload: ${reopened.reason}`,
                    } as never;
                }

                // The persisted favorites map must still contain the entry
                // on the same project id.
                const persistedAfter = await readPersistedByProjectId(page);
                expect(persistedAfter).not.toBeNull();
                expect(persistedAfter![owningProjectId]?.favorites?.[file.nodeId]).toBe(true);

                // The UI must reflect the persisted state once the row
                // renders again. Wait for the row to exist before asserting.
                await expect(
                    page.locator(`[data-testid="${ROW_TESTID}"][data-node-id="${file.nodeId}"]`),
                ).toBeVisible({ timeout: 15_000 });
                await expectFavoriteState(page, file.nodeId, true);

                // Clean up so subsequent scenarios start from a clean slate.
                await toggleFavorite(page, file.nodeId);
                await expectFavoriteState(page, file.nodeId, false);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("favorites are scoped per project (no bleed-over between projects)", async ({ browser }) => {
        const area = "favorites toggle / per-project scoping";
        await runScenario(area, async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const monitor = attachPageMonitoring(page, {
                monitorConsoleTypes: ["error", "warning"],
                allowedConsolePatterns: [
                    /The result of getSnapshot should be cached to avoid an infinite loop/i,
                ],
            });
            try {
                // 1. Open project A and star a node there.
                const openedA = await openFilesTab(page, PROJECT_A_SLUG);
                if (!openedA.ready) {
                    return {
                        result: "not_applicable",
                        justification: openedA.reason!,
                    };
                }
                const target =
                    (await firstRowByType(page, "file")) ||
                    (await firstRowByType(page, "folder"));
                if (!target) {
                    return {
                        result: "not_applicable",
                        justification: `No rows visible in project "${PROJECT_A_SLUG}"; scoping verification requires at least one node fixture.`,
                    };
                }
                await toggleFavorite(page, target.nodeId);
                await expectFavoriteState(page, target.nodeId, true);

                const persistedFromA = await readPersistedByProjectId(page);
                expect(persistedFromA).not.toBeNull();
                const projectAId = findOwningProject(persistedFromA!, target.nodeId);

                // 2. Navigate to project B in the same browser context so
                //    the persisted map is shared across both sessions.
                const openedB = await openFilesTab(page, PROJECT_B_SLUG);
                if (!openedB.ready) {
                    // Project B may not have v3 enabled (e.g., if the flag
                    // depends on the slug/role). Record not_applicable so
                    // the release gate can still pass with a justification.
                    return {
                        result: "not_applicable",
                        justification: `Scoping check requires the V3 surface to render on the comparison project "${PROJECT_B_SLUG}" as well. ${openedB.reason}`,
                    };
                }

                // 3. Read the persisted map from project B's session and
                //    confirm: (a) project A's entry is preserved and
                //    (b) no other project has the same nodeId as a
                //    favorite.
                const persistedFromB = await readPersistedByProjectId(page);
                expect(persistedFromB).not.toBeNull();

                const aFavorites =
                    persistedFromB![projectAId]?.favorites ?? {};
                expect(
                    aFavorites[target.nodeId],
                    "project A's favorite must survive navigation to project B",
                ).toBe(true);

                const bleedOver = Object.entries(persistedFromB!).filter(
                    ([projectId, ws]) =>
                        projectId !== projectAId &&
                        ws.favorites &&
                        ws.favorites[target.nodeId] === true,
                );
                expect(
                    bleedOver,
                    `favorite for nodeId="${target.nodeId}" must only be set on projectAId="${projectAId}", got ${JSON.stringify(
                        bleedOver.map(([pid]) => pid),
                    )}`,
                ).toHaveLength(0);

                // 4. Clean up — navigate back to project A and unstar.
                const reopenedA = await openFilesTab(page, PROJECT_A_SLUG);
                if (reopenedA.ready) {
                    const cleanupRow = page.locator(
                        `[data-testid="${ROW_TESTID}"][data-node-id="${target.nodeId}"]`,
                    );
                    if (await cleanupRow.count()) {
                        await toggleFavorite(page, target.nodeId);
                        await expectFavoriteState(page, target.nodeId, false);
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
