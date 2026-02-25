import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, measure } from "./_helpers/perf";
const fixtureProjectSlug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

test.describe("Files tab smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("create folder and move to trash", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page, {
            allowedConsolePatterns: [
                /The result of getSnapshot should be cached to avoid an infinite loop/i,
            ],
        });
        const perf = new PerfTracker();

        await login(page);
        await measure(perf, "route.interactive.core", () => page.goto(`/projects/${fixtureProjectSlug}`));
        await page.getByRole("button", { name: "Files", exact: true }).first().click();
        const actionsButton = page.getByRole("button", { name: "Actions" }).first();
        await expect(actionsButton).toBeVisible({ timeout: 15000 });
        await actionsButton.click();
        const newFolderMenuItem = page.getByRole("menuitem", { name: "New folder" });
        await expect(newFolderMenuItem).toBeVisible({ timeout: 15000 });
        await newFolderMenuItem.click();

        const firstFileEntry = page
            .locator("span")
            .filter({ hasText: /\.(md|txt|ts|tsx|js|jsx|json|css|html|py|sql)$/ })
            .first();
        if (await firstFileEntry.count()) {
            await firstFileEntry.click();
            const saveButton = page.getByRole("button", { name: /^Save$/ }).first();
            await expect(saveButton).toBeVisible();
            await expect(saveButton).toBeDisabled();
            await expect(page.getByText("Unsaved")).toHaveCount(0);
            await page.waitForTimeout(3500);
            await expect(saveButton).toBeDisabled();
            await expect(page.getByText("Unsaved")).toHaveCount(0);

            const readOnlyBadge = page.getByText("Read-only").first();
            if (await readOnlyBadge.count()) {
                await expect(readOnlyBadge).toBeVisible();
                await page.waitForTimeout(3500);
                await expect(readOnlyBadge).toBeVisible();
            }
        }

        const folderName = scopedName("pw-folder");
        await expect(page.getByRole("heading", { name: "Create folder" })).toBeVisible();
        await page.getByPlaceholder("Folder name").fill(folderName);
        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText(folderName, { exact: true }).first()).toBeVisible();

        await page.getByText(folderName, { exact: true }).first().click();
        await page.keyboard.press("Delete");
        await expect(page.getByRole("heading", { name: "Move to Trash" })).toBeVisible();
        await page.getByRole("button", { name: "Move to Trash" }).click();

        await page.getByTitle("Trash").click();
        await expect(page.getByText(folderName, { exact: true }).first()).toBeVisible();

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });

    test("bottom panel: terminal, output, problems, source control", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page, {
            allowedConsolePatterns: [
                /The result of getSnapshot should be cached to avoid an infinite loop/i,
            ],
        });

        await login(page);
        await page.goto(`/projects/${fixtureProjectSlug}`);
        await page.getByRole("button", { name: "Files", exact: true }).first().click();

        // Wait for Files workspace to load (header Panel button)
        await expect(page.getByRole("button", { name: "Panel", exact: true }).first()).toBeVisible({ timeout: 15000 });

        // Source Control: click explorer tab and verify no infinite loading (content visible within 15s)
        await page.getByTitle("Source Control").first().click();
        const sourceControlContent = page
            .getByText(/Connect a GitHub|Source Control|Everything up to date|No changed files|Repository URL/i)
            .first();
        await expect(sourceControlContent).toBeVisible({ timeout: 15000 });

        // Expand bottom panel (if needed) and verify Terminal, Output, Problems tabs
        const terminalTab = page.getByRole("button", { name: "Terminal" });
        const terminalAlreadyVisible = await terminalTab.isVisible().catch(() => false);
        if (!terminalAlreadyVisible) {
            await page.getByRole("button", { name: "Panel", exact: true }).first().click();
        }
        await expect(terminalTab).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole("button", { name: "Output", exact: true }).first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Problems" })).toBeVisible();

        // Open Terminal tab and run a command (if command input is available)
        await page.getByRole("button", { name: "Terminal" }).click();

        const terminalInput = page.getByTestId("terminal-command-input");
        if (await terminalInput.count()) {
            await expect(terminalInput).toBeVisible({ timeout: 5000 });
            await terminalInput.fill("python hello.py");
            await terminalInput.press("Enter");

            // Wait for execution (output appears or error)
            await expect(
                page.getByText(/\$ python hello\.py|Hello|File not found|error/i).first()
            ).toBeVisible({ timeout: 20000 });

            // Output tab shows execution result
            await page.getByRole("button", { name: "Output", exact: true }).first().click();
            await expect(page.getByText(/\$ python hello\.py|Hello|File not found|No output/i).first()).toBeVisible({ timeout: 5000 });
        } else {
            await expect(page.getByText(/No terminal session|Waiting for output/i)).toBeVisible({ timeout: 5000 });
        }

        // Problems tab renders
        await page.getByRole("button", { name: "Problems", exact: true }).first().click();
        await expect(page.getByText("No problems detected")).toBeVisible({ timeout: 5000 });

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
