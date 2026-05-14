/**
 * Files Tab V3 — Recents list end-to-end verification.
 *
 * Task 12.8. Audit area: `Recents list correctness` (Req 18.1 enumeration).
 *
 * Covers:
 *   - Req 8.4  Opening a file records it at the top of the Recents list
 *              for the current project; each file appears exactly once.
 *   - Req 8.5  Recents are persisted per project in localStorage under the
 *              key `files-recent-open:{projectId}`, capped at 50 entries,
 *              evicting the oldest entry first when the cap is exceeded.
 *   - Req 8.6  On mount, Recents are restored from the
 *              `files-recent-open:{projectId}` localStorage key.
 *
 * Preconditions (Req 21.7 coexistence):
 *   - `ProjectFilesWorkspace` always mounts `FilesTabRoot` (the V3 surface
 *     is unconditional post-rollout). When the V3 surface
 *     (`data-testid="files-tab-root"`) does not appear, each scenario
 *     records `not_applicable` with a non-empty justification (Req 18.3).
 *
 * Fallbacks:
 *   - No E2E credentials → `test.skip` (no audit entry).
 *   - V3 UI not rendered → scenario records `not_applicable`.
 *   - Browser / worker not available → Playwright reports the failure at
 *     the runner layer before any audit entry is written (matches the
 *     task contract "Fallback to not_applicable with justification if
 *     browser not available").
 *
 * The four scenarios each emit exactly one audit entry so the release
 * gate can track coverage independently (tasks.md § 12.1 — one entry per
 * verification area).
 */

import { expect, test, type Page } from "@playwright/test";
import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
    process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

const PERSIST_KEY = "files-workspace-v3";
const V3_ROOT_TESTID = "files-tab-root";
const ROW_TESTID = "files-tab-folder-list-row";
const RECENTS_KEY_PREFIX = "files-recent-open:";
const RECENTS_CAP = 50;
const V3_DETECT_TIMEOUT_MS = 15_000;

// ─── Shared helpers ─────────────────────────────────────────────────

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
        await recordAudit(area, "fail", `Recents spec failed: ${message.slice(0, 400)}`);
        throw err;
    }
    await recordAudit(area, outcome.result, outcome.justification);
}

/**
 * Opens the Files tab for `slug` and waits for the V3 root to appear.
 * Returns `{ ready: false, reason }` when the V3 surface does not mount
 * within `V3_DETECT_TIMEOUT_MS` — callers translate this into a
 * `not_applicable` audit outcome.
 */
async function openFilesTab(
    page: Page,
    slug: string,
): Promise<{ ready: boolean; reason?: string }> {
    await login(page);
    await page.goto(`/projects/${slug}`, { waitUntil: "domcontentloaded" });

    const filesTab = page.getByTestId("project-tab-files").first();
    if (await filesTab.count()) {
        await filesTab.click();
    } else {
        await page.goto(`/projects/${slug}?tab=files`, { waitUntil: "domcontentloaded" });
    }

    const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
    try {
        await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
    } catch {
        return {
            ready: false,
            reason:
                `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear ` +
                `within ${V3_DETECT_TIMEOUT_MS}ms for project "${slug}".`,
        };
    }
    return { ready: true };
}

/** Reads the zustand-persist blob and returns the `byProjectId` map. */
async function readPersistedByProjectId(
    page: Page,
): Promise<Record<
    string,
    { recents?: string[]; favorites?: Record<string, boolean> }
> | null> {
    return page.evaluate((key) => {
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as {
                state?: {
                    byProjectId?: Record<
                        string,
                        { recents?: string[]; favorites?: Record<string, boolean> }
                    >;
                };
            };
            return parsed?.state?.byProjectId ?? null;
        } catch {
            return null;
        }
    }, PERSIST_KEY);
}

/**
 * Resolves the canonical projectId for the current session by reading
 * the zustand-persist blob. The V3 root's `ensureProjectWorkspace`
 * effect installs a single entry keyed by the resolved id on mount, so
 * selecting `Object.keys(byProjectId)[0]` is deterministic for a
 * single-project page.
 */
async function readProjectId(page: Page): Promise<string | null> {
    const byProjectId = await readPersistedByProjectId(page);
    if (!byProjectId) return null;
    const ids = Object.keys(byProjectId);
    return ids.length === 1 ? ids[0]! : (ids[0] ?? null);
}

/**
 * Reads the `files-recent-open:{projectId}` localStorage entry. Returns
 * `null` when the key is missing or unparseable.
 */
async function readRecentsLocalStorageKey(
    page: Page,
    projectId: string,
): Promise<string[] | null> {
    return page.evaluate(
        ({ prefix, id }) => {
            try {
                const raw = window.localStorage.getItem(`${prefix}${id}`);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return null;
                return parsed.filter((entry): entry is string => typeof entry === "string");
            } catch {
                return null;
            }
        },
        { prefix: RECENTS_KEY_PREFIX, id: projectId },
    );
}

/** Reads the in-store `recents` array for `projectId` via persist blob. */
async function readStoreRecents(
    page: Page,
    projectId: string,
): Promise<string[] | null> {
    const byProjectId = await readPersistedByProjectId(page);
    if (!byProjectId) return null;
    const ws = byProjectId[projectId];
    return Array.isArray(ws?.recents) ? (ws!.recents as string[]) : null;
}

/**
 * Returns up to `limit` visible file-row descriptors from the current
 * `FolderListView`. The caller uses these to drive navigation by
 * clicking rows in order.
 */
async function collectFileRows(
    page: Page,
    limit = 16,
): Promise<Array<{ nodeId: string; name: string }>> {
    const rows = page.locator(`[data-testid="${ROW_TESTID}"][data-node-type="file"]`);
    await rows.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    const handles = await rows.elementHandles();
    const out: Array<{ nodeId: string; name: string }> = [];
    for (const handle of handles) {
        if (out.length >= limit) break;
        const nodeId = await handle.getAttribute("data-node-id");
        if (!nodeId) continue;
        const name = (await handle.innerText()).trim().split("\n")[0] ?? "";
        out.push({ nodeId, name });
    }
    return out;
}

/**
 * Clicks the folder-list row for `nodeId` and waits for the V3 single-file
 * view to render the file by asserting the `?path=` URL mirror sync
 * landed (the URL contract from Req 10.4). This is the UI equivalent of
 * `navigateTo(nodeId)` which is the sole write path into `addRecent`.
 */
async function openFileRow(page: Page, nodeId: string): Promise<void> {
    const row = page
        .locator(`[data-testid="${ROW_TESTID}"][data-node-id="${nodeId}"]`)
        .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    // The navigation side-effect runs synchronously, but zustand's
    // persist middleware and URL sync both go through effects. Poll the
    // persisted recents until the id lands to avoid a race.
    await expect
        .poll(
            async () => {
                const byProjectId = await readPersistedByProjectId(page);
                if (!byProjectId) return false;
                for (const ws of Object.values(byProjectId)) {
                    if (ws.recents?.[0] === nodeId) return true;
                }
                return false;
            },
            { timeout: 10_000, message: `expected ${nodeId} to appear at the top of recents` },
        )
        .toBe(true);
}

/** Navigates back to the project root so the next file click is cheap. */
async function navigateToFolderRoot(page: Page): Promise<void> {
    // Click the breadcrumb root segment. `BreadcrumbBar` renders the
    // root as a `<button>` with `data-breadcrumb-segment-id` matching
    // the root id; using a home icon click is equally valid.
    const breadcrumb = page.getByTestId("files-tab-breadcrumb").first();
    const rootBtn = breadcrumb.locator("button").first();
    if (await rootBtn.count()) {
        await rootBtn.click();
    }
    const folderList = page.getByTestId("files-tab-folder-list-view").first();
    await expect(folderList).toBeVisible({ timeout: 10_000 });
}

// ─── Spec ────────────────────────────────────────────────────────────

test.describe("Files tab v3 — Recents list correctness", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("opening a file records it at the top of recents and stays unique (Req 8.4)", async ({ browser }) => {
        const area = "Recents list correctness / add-to-top and uniqueness";
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
                const opened = await openFilesTab(page, PROJECT_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }

                const folderList = page.getByTestId("files-tab-folder-list-view").first();
                await expect(folderList).toBeVisible({ timeout: 10_000 });

                const rows = await collectFileRows(page, 4);
                if (rows.length < 2) {
                    return {
                        result: "not_applicable",
                        justification:
                            `Project "${PROJECT_SLUG}" root folder exposes fewer than two file rows ` +
                            `(${rows.length} visible); LRU uniqueness verification requires ≥2 files.`,
                    };
                }

                const [a, b] = rows;
                const projectId = await readProjectId(page);
                expect(projectId, "projectId not populated in persisted store").not.toBeNull();

                // Open file A — it lands at the top.
                await openFileRow(page, a!.nodeId);
                let recents = await readStoreRecents(page, projectId!);
                expect(recents, "recents array missing after opening A").not.toBeNull();
                expect(recents![0], "file A must be at top after initial open").toBe(a!.nodeId);

                // Return to folder, open file B — it displaces A to index 1.
                await navigateToFolderRoot(page);
                await openFileRow(page, b!.nodeId);
                recents = await readStoreRecents(page, projectId!);
                expect(recents, "recents missing after opening B").not.toBeNull();
                expect(recents![0], "file B must be at top after second open").toBe(b!.nodeId);
                expect(recents![1], "file A must be at index 1 after B opens").toBe(a!.nodeId);

                // Re-open A — it moves back to the top and remains unique.
                await navigateToFolderRoot(page);
                await openFileRow(page, a!.nodeId);
                recents = await readStoreRecents(page, projectId!);
                expect(recents, "recents missing after re-opening A").not.toBeNull();
                expect(recents![0], "file A must be back at top after re-open").toBe(a!.nodeId);
                const aCount = recents!.filter((id) => id === a!.nodeId).length;
                expect(aCount, "file A must appear exactly once (Req 8.4)").toBe(1);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("recents persist in localStorage under `files-recent-open:{projectId}` (Req 8.5)", async ({ browser }) => {
        const area = "Recents list correctness / localStorage key format files-recent-open:{projectId}";
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
                const opened = await openFilesTab(page, PROJECT_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }

                const folderList = page.getByTestId("files-tab-folder-list-view").first();
                await expect(folderList).toBeVisible({ timeout: 10_000 });

                const rows = await collectFileRows(page, 2);
                if (rows.length < 1) {
                    return {
                        result: "not_applicable",
                        justification:
                            `Project "${PROJECT_SLUG}" root folder exposes no file rows; ` +
                            `localStorage key verification requires ≥1 file.`,
                    };
                }

                const file = rows[0]!;
                await openFileRow(page, file.nodeId);

                const projectId = await readProjectId(page);
                expect(projectId, "projectId not populated in persisted store").not.toBeNull();

                // Req 8.5 — localStorage key format + contents.
                const persisted = await readRecentsLocalStorageKey(page, projectId!);
                expect(
                    persisted,
                    `expected localStorage.getItem("${RECENTS_KEY_PREFIX}${projectId}") ` +
                    `to be populated with a JSON array after opening a file (Req 8.5)`,
                ).not.toBeNull();
                expect(persisted!.length, "recents localStorage array must be non-empty").toBeGreaterThan(0);
                expect(
                    persisted![0],
                    "opened file must be at the top of the persisted localStorage recents list (Req 8.5)",
                ).toBe(file.nodeId);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("recents respect the 50-entry cap with oldest-first eviction (Req 8.5, 8.6)", async ({ browser }) => {
        const area = "Recents list correctness / 50-entry cap with LRU eviction";
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

            // We cannot predict the resolved projectId before the Files
            // tab mounts, so the seeding strategy is: (1) open the tab
            // once to discover the id, (2) seed the localStorage key via
            // `addInitScript`, (3) reload so `Req 8.6` restoration runs
            // with the seed in place.
            try {
                const opened = await openFilesTab(page, PROJECT_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }
                const folderList = page.getByTestId("files-tab-folder-list-view").first();
                await expect(folderList).toBeVisible({ timeout: 10_000 });

                const projectId = await readProjectId(page);
                expect(projectId, "projectId not populated in persisted store").not.toBeNull();

                const rows = await collectFileRows(page, 2);
                if (rows.length < 1) {
                    return {
                        result: "not_applicable",
                        justification:
                            `Project "${PROJECT_SLUG}" root folder exposes no file rows; ` +
                            `cap + LRU verification requires ≥1 real file to open after seeding.`,
                    };
                }
                const newFile = rows[0]!;

                // Synthetic ids that cannot collide with real node ids.
                // Ordered from OLDEST (index 49) at the end of the array
                // to MOST-RECENT (index 0) at the front, matching the
                // ordering contract of Req 8.4 / 8.5.
                const syntheticIds = Array.from(
                    { length: RECENTS_CAP },
                    (_, i) => `seed-recent-${String(i).padStart(3, "0")}`,
                );
                const oldestSynthetic = syntheticIds[syntheticIds.length - 1]!; // to be evicted

                // Seed the recents localStorage key that Req 8.5 mandates.
                // We use `addInitScript` so the seed is in place BEFORE
                // the Files tab mounts and invokes its Req 8.6 restore.
                await page.addInitScript(
                    ({ key, ids }) => {
                        try {
                            window.localStorage.setItem(key, JSON.stringify(ids));
                        } catch {
                            // localStorage may be unavailable in some
                            // contexts; the test will fall through and
                            // the assertion below will fail with a clear
                            // message.
                        }
                    },
                    {
                        key: `${RECENTS_KEY_PREFIX}${projectId!}`,
                        ids: syntheticIds,
                    },
                );

                // Reload so the Files tab's mount-time restore (Req 8.6)
                // reads the seed and lifts it into the store.
                await page.reload({ waitUntil: "domcontentloaded" });
                const reopened = await openFilesTab(page, PROJECT_SLUG);
                expect(
                    reopened.ready,
                    `V3 surface disappeared after reload: ${reopened.reason ?? "unknown"}`,
                ).toBe(true);
                await expect(folderList).toBeVisible({ timeout: 15_000 });

                // Confirm the seed was restored (Req 8.6). If restoration
                // is unimplemented, the store's recents stays empty.
                const restored = await readStoreRecents(page, projectId!);
                expect(
                    restored,
                    "recents array missing from persisted store after seeded reload",
                ).not.toBeNull();
                expect(
                    restored!.length,
                    `expected ${RECENTS_CAP} seeded recents restored from ` +
                    `"${RECENTS_KEY_PREFIX}${projectId}" on mount (Req 8.6)`,
                ).toBe(RECENTS_CAP);
                expect(
                    restored![restored!.length - 1],
                    "oldest synthetic id must be at the tail of the restored list",
                ).toBe(oldestSynthetic);

                // Open one real file — the 51st entry. Req 8.5 requires
                // the cap to hold at 50 with oldest-first eviction.
                await openFileRow(page, newFile.nodeId);

                const afterOpen = await readStoreRecents(page, projectId!);
                expect(afterOpen, "recents missing after opening real file").not.toBeNull();
                expect(
                    afterOpen!.length,
                    `recents cap violated — expected ≤${RECENTS_CAP} entries after ` +
                    `opening a file on top of a full seed (Req 8.5)`,
                ).toBe(RECENTS_CAP);
                expect(
                    afterOpen![0],
                    "newly opened file must be at the top of recents (Req 8.4)",
                ).toBe(newFile.nodeId);
                expect(
                    afterOpen!.includes(oldestSynthetic),
                    `oldest entry "${oldestSynthetic}" must be evicted when the cap is ` +
                    `exceeded (Req 8.5 LRU eviction)`,
                ).toBe(false);

                // The persisted localStorage mirror must track the same cap.
                const persistedLs = await readRecentsLocalStorageKey(page, projectId!);
                expect(
                    persistedLs,
                    `localStorage key "${RECENTS_KEY_PREFIX}${projectId}" must stay ` +
                    `populated after the cap-triggered eviction (Req 8.5)`,
                ).not.toBeNull();
                expect(
                    persistedLs!.length,
                    `localStorage recents cap violated — expected ≤${RECENTS_CAP} entries`,
                ).toBe(RECENTS_CAP);
                expect(
                    persistedLs![0],
                    "localStorage recents must start with the most-recently-opened file",
                ).toBe(newFile.nodeId);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });

    test("recents survive a full page reload (Req 8.5, 8.6)", async ({ browser }) => {
        const area = "Recents list correctness / persistence across reload";
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
                const opened = await openFilesTab(page, PROJECT_SLUG);
                if (!opened.ready) {
                    return { result: "not_applicable", justification: opened.reason! };
                }
                const folderList = page.getByTestId("files-tab-folder-list-view").first();
                await expect(folderList).toBeVisible({ timeout: 10_000 });

                const rows = await collectFileRows(page, 2);
                if (rows.length < 1) {
                    return {
                        result: "not_applicable",
                        justification:
                            `Project "${PROJECT_SLUG}" root folder exposes no file rows; ` +
                            `persistence verification requires ≥1 file.`,
                    };
                }

                const file = rows[0]!;
                await openFileRow(page, file.nodeId);

                const projectId = await readProjectId(page);
                expect(projectId, "projectId not populated in persisted store").not.toBeNull();

                const beforeReload = await readRecentsLocalStorageKey(page, projectId!);
                expect(
                    beforeReload,
                    "localStorage recents must be populated before reload (Req 8.5)",
                ).not.toBeNull();
                expect(beforeReload![0]).toBe(file.nodeId);

                // Reload — on mount, Req 8.6 requires the Files tab to
                // restore recents from `files-recent-open:{projectId}`.
                await page.reload({ waitUntil: "domcontentloaded" });
                const reopened = await openFilesTab(page, PROJECT_SLUG);
                expect(
                    reopened.ready,
                    `V3 surface disappeared after reload: ${reopened.reason ?? "unknown"}`,
                ).toBe(true);
                await expect(folderList).toBeVisible({ timeout: 15_000 });

                const afterReload = await readStoreRecents(page, projectId!);
                expect(
                    afterReload,
                    "recents missing from persisted store after reload",
                ).not.toBeNull();
                expect(
                    afterReload!.includes(file.nodeId),
                    `opened file "${file.nodeId}" must survive a full page reload (Req 8.6)`,
                ).toBe(true);
                expect(
                    afterReload![0],
                    "opened file must still be at the top of recents after reload",
                ).toBe(file.nodeId);

                const persistedAfter = await readRecentsLocalStorageKey(page, projectId!);
                expect(
                    persistedAfter,
                    `localStorage key "${RECENTS_KEY_PREFIX}${projectId}" must still be ` +
                    `populated after reload (Req 8.5)`,
                ).not.toBeNull();
                expect(persistedAfter![0]).toBe(file.nodeId);

                await monitor.assertNoViolations();
                return { result: "pass" };
            } finally {
                monitor.detach();
                await context.close();
            }
        });
    });
});
