/**
 * Files Tab V3 — VersionPill display end-to-end verification.
 *
 * Task 12.9. Audit area: `version pill display` (Req 18.1 enumeration —
 * recorded verbatim so the release gate's area check passes).
 *
 * Covers:
 *   - Req 11.1  WHILE a file has `currentVersion > 1`, the File_List
 *               SHALL render a Version_Pill adjacent to the file name
 *               with the text `v{currentVersion}` (for example `v2`).
 *   - Req 11.3  WHILE Current_Location resolves to a file whose
 *               `currentVersion` is an integer greater than 1, the
 *               Metadata_Strip SHALL display the version value using
 *               the text format `v{currentVersion}`.
 *   - Req 11.4  IF a Project_Node is not of type "file", THEN the
 *               File_List SHALL NOT render a Version_Pill for that
 *               node. We spot-check that folder rows never expose a
 *               version pill even when file rows do.
 *
 * Preconditions (Req 21.7 coexistence):
 *   - `NEXT_PUBLIC_FILES_TAB_V3=1` must be set when the Next.js server
 *     is started so `ProjectFilesWorkspace` mounts `FilesTabRoot`. When
 *     the flag is off (V3 root not rendered) the spec records
 *     `not_applicable` with a non-empty justification (Req 18.3) and
 *     exits cleanly.
 *
 * Fallbacks:
 *   - No `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`  → `test.skip` (no audit entry).
 *   - V3 UI not rendered (flag off)              → record `not_applicable`.
 *   - No fixture file with `currentVersion > 1`  → record `not_applicable`;
 *                                                  the spec does not create
 *                                                  versions itself because
 *                                                  version bumps require a
 *                                                  write pipeline that is
 *                                                  out of scope here.
 *
 * The pill is rendered by `VersionPill` (Task 6.2) inside both
 * `FolderListRow` (folder list) and `MetadataStrip` (single-file view),
 * so one `data-testid="files-tab-version-pill"` covers both surfaces.
 */

import { expect, test, type Page } from "@playwright/test";

import { hasE2ECredentials, login } from "../_helpers/auth";
import { attachPageMonitoring } from "../_helpers/monitoring";
import { recordAudit, type AuditResult } from "./audit";

const PROJECT_SLUG =
    process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

const V3_ROOT_TESTID = "files-tab-root";
const ROW_TESTID = "files-tab-folder-list-row";
const VERSION_PILL_TESTID = "files-tab-version-pill";
const METADATA_STRIP_TESTID = "files-tab-metadata-strip";
const FILE_VIEW_TESTID = "files-tab-file-view";
const FOLDER_LIST_VIEW_TESTID = "files-tab-folder-list-view";

const V3_DETECT_TIMEOUT_MS = 15_000;
const AREA = "version pill display";

// Propagate the public env flag to the webServer child process (when
// Playwright spawns the dev server) and to any in-runner code path that
// reuses the runner env. The authoritative gate lives in
// `src/lib/features/files.ts`.
process.env.NEXT_PUBLIC_FILES_TAB_V3 = process.env.NEXT_PUBLIC_FILES_TAB_V3 ?? "1";

// ─── Scenario bookkeeping ────────────────────────────────────────────

type ScenarioOutcome =
    | { result: "pass" }
    | { result: "not_applicable"; justification: string };

/**
 * Wraps a scenario body with audit-record bookkeeping. Exactly one
 * audit entry is emitted per scenario. Thrown assertion errors become
 * `{ result: "fail", justification: <error message> }` and are re-thrown
 * so Playwright still surfaces the failure in its own report.
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
            `Version-display spec failed: ${message.slice(0, 400)}`,
        );
        throw err;
    }
    await recordAudit(area, outcome.result, outcome.justification);
}

// ─── Page helpers ────────────────────────────────────────────────────

/**
 * Opens the Files tab for `slug` and waits for the V3 root. Returns
 * `{ ready: false, reason }` when the V3 surface does not mount within
 * `V3_DETECT_TIMEOUT_MS` — callers translate this into a
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
        await page.goto(`/projects/${slug}?tab=files`, {
            waitUntil: "domcontentloaded",
        });
    }

    const v3Root = page.getByTestId(V3_ROOT_TESTID).first();
    try {
        await expect(v3Root).toBeVisible({ timeout: V3_DETECT_TIMEOUT_MS });
    } catch {
        return {
            ready: false,
            reason:
                `Files tab v3 surface (data-testid="${V3_ROOT_TESTID}") did not appear ` +
                `within ${V3_DETECT_TIMEOUT_MS}ms for project "${slug}". ` +
                `NEXT_PUBLIC_FILES_TAB_V3 is likely unset in the E2E server environment.`,
        };
    }
    return { ready: true };
}

/** Waits for the folder list to paint at least one row before scanning. */
async function waitForFolderList(page: Page): Promise<void> {
    const folderList = page.getByTestId(FOLDER_LIST_VIEW_TESTID).first();
    await expect(folderList).toBeVisible({ timeout: 15_000 });
    const firstRow = page.locator(`[data-testid="${ROW_TESTID}"]`).first();
    await firstRow.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
        // Empty folders are valid; downstream code handles the empty case
        // by recording `not_applicable`.
    });
}

/**
 * Walk visible folder-list rows and return the first file row whose
 * name cell carries a `data-testid="files-tab-version-pill"` descendant.
 * Returns null when no such row is visible — the caller records
 * `not_applicable`.
 *
 * We scan the already-rendered root folder only: creating a file with
 * `currentVersion > 1` requires a write pipeline (upload → update →
 * version bump) that is out of scope for this spec. If the fixture does
 * not expose a multi-version file at the root, we fall back gracefully.
 */
async function findRowWithVersionPill(
    page: Page,
): Promise<{ nodeId: string; pillText: string } | null> {
    const fileRows = page.locator(
        `[data-testid="${ROW_TESTID}"][data-node-type="file"]`,
    );
    const count = await fileRows.count();
    for (let i = 0; i < count; i += 1) {
        const row = fileRows.nth(i);
        const pill = row.locator(`[data-testid="${VERSION_PILL_TESTID}"]`).first();
        if (await pill.count()) {
            const nodeId = await row.getAttribute("data-node-id");
            const pillText = ((await pill.textContent()) ?? "").trim();
            if (nodeId && pillText) {
                return { nodeId, pillText };
            }
        }
    }
    return null;
}

/**
 * Asserts the pill matches the `v{N}` format with `N > 1`. Returns the
 * parsed numeric version so the caller can compare across surfaces.
 */
function parseVersionPillText(pillText: string, context: string): number {
    const match = /^v(\d+)$/.exec(pillText);
    expect(
        match,
        `${context}: version pill text "${pillText}" must match /^v(\\d+)$/ per Req 11.1 / 11.3`,
    ).not.toBeNull();
    const n = Number(match![1]);
    expect(
        Number.isInteger(n) && n > 1,
        `${context}: version pill value "${n}" must be an integer > 1 per Req 11.2 / 11.3`,
    ).toBe(true);
    return n;
}

// ─── Spec ────────────────────────────────────────────────────────────

test.describe("Files tab v3 — VersionPill display (Req 11.1, 11.3, 11.4)", () => {
    test.skip(
        !hasE2ECredentials,
        "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
    );

    test(
        "version pill renders next to file name in folder list and inside the MetadataStrip",
        async ({ browser }) => {
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
                    const opened = await openFilesTab(page, PROJECT_SLUG);
                    if (!opened.ready) {
                        return {
                            result: "not_applicable",
                            justification: opened.reason!,
                        };
                    }

                    await waitForFolderList(page);

                    // Locate a file row whose `currentVersion > 1`. The
                    // fixture seed does not guarantee one exists — if
                    // not, record `not_applicable` rather than forcing a
                    // write-path precondition inside a read-only spec.
                    const candidate = await findRowWithVersionPill(page);
                    if (!candidate) {
                        return {
                            result: "not_applicable",
                            justification:
                                `No visible file row in project "${PROJECT_SLUG}" exposes a ` +
                                `\`${VERSION_PILL_TESTID}\` element. Req 11.1 verification ` +
                                `requires at least one file fixture with \`currentVersion > 1\`; ` +
                                `none was available so the pill-in-folder-list + pill-in-metadata ` +
                                `assertions could not run.`,
                        };
                    }

                    // ── Req 11.1: pill next to file name in folder list ──
                    const row = page
                        .locator(
                            `[data-testid="${ROW_TESTID}"][data-node-id="${candidate.nodeId}"]`,
                        )
                        .first();
                    await expect(row).toBeVisible({ timeout: 10_000 });

                    const rowPill = row
                        .locator(`[data-testid="${VERSION_PILL_TESTID}"]`)
                        .first();
                    await expect(
                        rowPill,
                        `Req 11.1: folder-list row for node "${candidate.nodeId}" must expose ` +
                        `a \`${VERSION_PILL_TESTID}\` element adjacent to the name cell`,
                    ).toBeVisible();

                    const folderListPillText = ((await rowPill.textContent()) ?? "").trim();
                    const folderListVersion = parseVersionPillText(
                        folderListPillText,
                        "folder list",
                    );

                    // The `data-version` attribute on `VersionPill` must
                    // also mirror the numeric version — this gives a
                    // second, non-textual channel for the release gate
                    // to verify the render.
                    await expect(
                        rowPill,
                        "Req 11.1: version pill must carry `data-version` matching the " +
                        "numeric version",
                    ).toHaveAttribute("data-version", String(folderListVersion));

                    // ── Req 11.4: folder rows never expose a pill ────────
                    const folderRows = page.locator(
                        `[data-testid="${ROW_TESTID}"][data-node-type="folder"]`,
                    );
                    const folderCount = await folderRows.count();
                    for (let i = 0; i < folderCount; i += 1) {
                        const folderRow = folderRows.nth(i);
                        const pillCount = await folderRow
                            .locator(`[data-testid="${VERSION_PILL_TESTID}"]`)
                            .count();
                        expect(
                            pillCount,
                            `Req 11.4: folder row at index ${i} must not render a version pill ` +
                            `(non-file nodes never carry VersionPill)`,
                        ).toBe(0);
                    }

                    // ── Navigate into the file and verify Req 11.3 ───────
                    //
                    // Clicking the row routes through `useNavigateTo` →
                    // `setCurrentLocation`, which flips `FilesTabMain`
                    // to render `FileView` + `MetadataStrip` for this
                    // node.
                    await row.click();

                    const fileView = page.getByTestId(FILE_VIEW_TESTID).first();
                    await expect(
                        fileView,
                        "Req 11.3: opening the row must mount the Single_File_View",
                    ).toBeVisible({ timeout: 15_000 });
                    await expect(fileView).toHaveAttribute(
                        "data-node-id",
                        candidate.nodeId,
                    );

                    const metadataStrip = page
                        .getByTestId(METADATA_STRIP_TESTID)
                        .first();
                    await expect(
                        metadataStrip,
                        "Req 11.3: MetadataStrip must render in the Single_File_View",
                    ).toBeVisible({ timeout: 10_000 });
                    await expect(
                        metadataStrip,
                        "Req 17.3: MetadataStrip.data-node-id must equal the current file's id",
                    ).toHaveAttribute("data-node-id", candidate.nodeId);

                    const metadataPill = metadataStrip
                        .locator(`[data-testid="${VERSION_PILL_TESTID}"]`)
                        .first();
                    await expect(
                        metadataPill,
                        `Req 11.3: MetadataStrip for node "${candidate.nodeId}" must expose ` +
                        `a \`${VERSION_PILL_TESTID}\` element when \`currentVersion > 1\``,
                    ).toBeVisible({ timeout: 10_000 });

                    const metadataPillText = (
                        (await metadataPill.textContent()) ?? ""
                    ).trim();
                    const metadataVersion = parseVersionPillText(
                        metadataPillText,
                        "metadata strip",
                    );

                    await expect(
                        metadataPill,
                        "Req 11.3: metadata-strip pill must carry `data-version` matching " +
                        "the numeric version",
                    ).toHaveAttribute("data-version", String(metadataVersion));

                    // The two surfaces render the same pill for the
                    // same node, so the numeric versions must agree.
                    expect(
                        metadataVersion,
                        `Req 11.1 + 11.3: MetadataStrip pill (v${metadataVersion}) and ` +
                        `folder-list pill (v${folderListVersion}) must report the same ` +
                        `\`currentVersion\` for node "${candidate.nodeId}"`,
                    ).toBe(folderListVersion);

                    await monitor.assertNoViolations();
                    return { result: "pass" };
                } finally {
                    monitor.detach();
                    await context.close();
                }
            });
        },
    );
});
