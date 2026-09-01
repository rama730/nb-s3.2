import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "../_helpers/auth";

const slug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

// Read-only: safe to run against an explicitly chosen public project without
// fixture credentials. This suite never uploads, edits, stars or deletes files.
test.describe("compact Files workspace", () => {
  test.skip(!hasE2ECredentials && !process.env.E2E_FILES_PROJECT_SLUG, "Supply a public project slug or E2E fixture credentials.");
  test.beforeEach(async ({ page }) => {
    if (hasE2ECredentials) await login(page);
  });

  test("sidebar collapse retains exactly one location row", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${slug}?tab=files&filesNav=tree`);
    const header = page.getByTestId("files-workspace-header");
    await expect(page.getByTestId("files-workspace-menu")).toBeVisible();
    const hide = page.getByRole("button", { name: "Hide sidebar", exact: true });
    if (!(await hide.isVisible())) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    const before = await header.boundingBox();
    await hide.click();
    await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeVisible();
    expect(await header.count()).toBe(1);
    const after = await header.boundingBox();
    expect(before?.height).toBe(48);
    expect(after?.height).toBe(48);
    expect(after?.y).toBe(before?.y);
    await expect(page.getByTestId("files-tab-root").locator("input:visible")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await expect(hide).toBeVisible();
  });

  test("mobile search has focus, fits the viewport and releases pointer/focus locks", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${slug}?tab=files`);
    await expect(page.getByTestId("files-workspace-menu")).toBeVisible();
    const hide = page.getByRole("button", { name: "Hide sidebar", exact: true });
    if (await hide.isVisible()) await hide.click();
    const menu = page.getByTestId("files-workspace-menu");
    await menu.click();
    await page.getByRole("menuitem", { name: "Search…", exact: true }).click();
    const input = page.getByRole("combobox", { name: "Search project files", exact: true });
    await expect(input).toBeFocused();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
    await input.fill("README");
    await page.getByRole("button", { name: "Show results in file list", exact: true }).click();
    await expect(page.getByTestId("files-workspace-header")).toContainText("Search results");
    await page.getByRole("button", { name: "Clear search: README", exact: true }).click();
    await menu.click();
    await page.getByRole("menuitem", { name: "Search…", exact: true }).click();
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await expect(hide).toBeVisible();
  });

  test("collection search is on demand without adding a toolbar", async ({ page }) => {
    await page.goto(`/projects/${slug}?tab=files&filesView=recent`);
    const menu = page.getByTestId("files-workspace-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("files-workspace-header")).toContainText("Recent");
    await menu.click();
    await page.getByRole("menuitem", { name: "Search…", exact: true }).click();
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.getByRole("searchbox").fill("README");
    await page.getByRole("button", { name: "Show results", exact: true }).click();
    await page.getByRole("button", { name: "Clear search: README", exact: true }).click();
    await expect(page.getByTestId("files-workspace-header")).toHaveCount(1);
    await expect(page.getByTestId("files-tab-root").locator("input:visible")).toHaveCount(0);
    await menu.click();
    await page.getByRole("menuitem", { name: "About recent…", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("this browser");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none");
  });

  test("search results can be revisited, while a breadcrumb opens the unfiltered folder", async ({ page }) => {
    await page.goto(`/projects/${slug}?tab=files&filesQuery=README`);
    const header = page.getByTestId("files-workspace-header");
    const file = page.getByTestId("files-tab-folder-list-row").filter({ has: page.getByTestId("files-tab-folder-list-name").filter({ hasText: /^README\.md$/ }) }).first();
    await expect(file).toBeVisible();
    await file.click();
    await expect(page.getByTestId("files-tab-file-view")).toBeVisible();
    await header.getByRole("button", { name: "Back to search results", exact: true }).click();
    await expect(header).toContainText("Search results");
    await expect(file).toBeVisible();
    await file.click();
    await expect(page.getByTestId("files-tab-file-view")).toBeVisible();
    await page.getByTestId("files-tab-breadcrumb").getByRole("button", { name: "Project files", exact: true }).click();
    await expect(page.getByTestId("files-tab-file-view")).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Clear search: README" })).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("filesQuery")).toBeNull();
    await expect(page.getByTestId("files-tab-folder-list-row").first()).toBeVisible();
  });

  test("Transfers is on demand and leaves the compact header usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${slug}?tab=files`);
    const menu = page.getByTestId("files-workspace-menu");
    await menu.click();
    await page.getByRole("menuitem", { name: "Transfers…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Transfers", exact: true });
    await expect(dialog).toContainText("No transfers in this session");
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none");
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Search…", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("files-workspace-header")).toHaveCount(1);
  });
});
