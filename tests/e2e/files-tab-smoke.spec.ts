import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, markNavigationMetrics, measure, measureWithTiming } from "./_helpers/perf";
const fixtureProjectSlug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

test.describe("Files tab smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("folder tree, context menu, and non-destructive delete affordance are stable", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page, {
            monitorConsoleTypes: ["error", "warning"],
            allowedHttpUrlPatterns: [/\/projects\/e2e-files-workspace-controls\?tab=files$/i],
            allowedConsolePatterns: [
                /The result of getSnapshot should be cached to avoid an infinite loop/i,
            ],
        });
        const perf = new PerfTracker();

        await login(page);
        await measure(perf, "route.interactive.core", () =>
            page.goto(`/projects/${fixtureProjectSlug}`, { waitUntil: "domcontentloaded" })
        );
        await markNavigationMetrics(perf, page, `/projects/${fixtureProjectSlug}`);
        const ensureFilesWorkspaceSession = async () => {
            const signInLink = page.getByRole("link", { name: "Sign in" });
            const signedOut = await signInLink.isVisible().catch(() => false);
            if (!signedOut) return;
            await login(page);
            await page.goto(`/projects/${fixtureProjectSlug}?tab=files`);
            const filesTab = page.getByTestId("project-tab-files").first();
            if (await filesTab.count()) {
                await filesTab.click();
            }
            await expect(page.getByTestId("files-tab-root").first()).toBeVisible({ timeout: 15000 });
        };
        const filesTab = page.getByTestId("project-tab-files").first();
        await filesTab.hover();
        await page.waitForTimeout(200);
        const { elapsedMs: filesOpenMs } = await measureWithTiming(async () => {
            await filesTab.click();
            await expect(filesTab).toHaveAttribute("data-active", "true", { timeout: 15000 });
            await expect(page.getByTestId("files-tab-root").first()).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId("files-tab-folder-list-header").first()).toBeVisible({ timeout: 15000 });
        });
        perf.mark("project.detail.files.tab.open", filesOpenMs, `/projects/${fixtureProjectSlug}?tab=files`);
        await expect
            .poll(() => new URL(page.url()).searchParams.get("tab"), { timeout: 15000 })
            .toBe("files");
        await expect(page.getByRole("treeitem", { name: /workspace/i }).first()).toBeVisible({ timeout: 15000 });
        const folderRows = page.locator('[data-testid="files-tab-folder-list-row"][data-node-type="folder"]');
        await expect(folderRows.first()).toBeVisible({ timeout: 15000 });
        await folderRows.first().click({ button: "right" });
        const newFolderMenuItem = page.getByRole("menuitem", { name: "New folder" });
        await expect(newFolderMenuItem).toBeVisible({ timeout: 15000 });
        await newFolderMenuItem.click();

        const folderName = scopedName("pw-folder");
        await expect(page.getByRole("heading", { name: "Create folder" })).toBeVisible();
        await page.getByPlaceholder("Folder name").fill(folderName);
        await page.getByRole("button", { name: "Cancel" }).click();
        await ensureFilesWorkspaceSession();
        await expect(page.getByRole("heading", { name: "Create folder" })).toHaveCount(0);

        await folderRows.first().click({ button: "right" });
        await expect(page.getByRole("menuitem", { name: "Move to trash" })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press("Escape");
        await expect(folderRows.first()).toBeVisible();

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });

    test("folder navigation and file preview surfaces", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page, {
            monitorConsoleTypes: ["error", "warning"],
            allowedHttpUrlPatterns: [/\/projects\/e2e-files-workspace-controls\?tab=files$/i],
            allowedConsolePatterns: [
                /The result of getSnapshot should be cached to avoid an infinite loop/i,
            ],
        });

        await login(page);
        await page.goto(`/projects/${fixtureProjectSlug}`);
        await page.getByTestId("project-tab-files").first().click();

        await expect(page.getByTestId("files-tab-root").first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId("files-tab-breadcrumb").first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId("files-tab-folder-list-header").first()).toBeVisible({ timeout: 15000 });

        const firstFolder = page.locator('[data-testid="files-tab-folder-list-row"][data-node-type="folder"]').first();
        if (await firstFolder.isVisible().catch(() => false)) {
            await firstFolder.click();
            await expect(page.getByTestId("files-tab-breadcrumb").first()).toContainText(/workspace|root/i, { timeout: 15000 });
        }

        const firstFile = page.locator('[data-testid="files-tab-folder-list-row"][data-node-type="file"]').first();
        if (await firstFile.isVisible().catch(() => false)) {
            await firstFile.click();
            await expect(page.getByTestId("files-tab-file-view").first()).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId("files-tab-file-actions-bar").first()).toBeVisible({ timeout: 15000 });
        } else {
            await expect(
                page.getByTestId("files-tab-folder-list-view").or(page.getByTestId("files-tab-folder-list-empty")).first(),
            ).toBeVisible({ timeout: 15000 });
        }

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
