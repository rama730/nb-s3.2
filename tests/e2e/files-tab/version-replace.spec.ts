/**
 * Revision upload acceptance: use only a new disposable file. Missing controls
 * fail the test; unavailable credentials are the only environment skip.
 */
import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "../_helpers/auth";
import { scopedName } from "../_helpers/fixtures";
import { recordAudit } from "./audit";

const slug = process.env.E2E_FILES_PROJECT_SLUG || "e2e-files-workspace-controls";

test.describe("Files revision upload", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("new revision preserves the prior version and updates history", async ({ page }) => {
    try {
      await login(page);
      await page.goto(`/projects/${slug}?tab=files`);
      await expect(page.getByTestId("files-tab-root")).toBeVisible();
      await page.getByRole("navigation", { name: "File collections" })
        .getByRole("button", { name: "Project files", exact: true }).click();
      const list = page.getByTestId("files-tab-folder-list-view");
      await list.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New file", exact: true }).click();
      const name = `${scopedName("pw-revision")}.txt`;
      const create = page.getByRole("dialog", { name: "Create file" });
      await create.getByPlaceholder(/File name/).fill(name);
      await create.getByRole("button", { name: "Create", exact: true }).click();
      await expect(create).not.toBeVisible();
      await list.getByRole("searchbox", { name: "Search project files" }).fill(name);
      await list.getByTestId("files-tab-folder-list-row").filter({ hasText: name }).click();
      await expect(page.getByTestId("files-tab-file-view")).toBeVisible();

      await page.getByRole("button", { name: "Actions", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("menuitem", { name: "Upload a file revision" }).click();
      await (await chooser).setFiles({
        name, mimeType: "text/plain", buffer: Buffer.from("Revision acceptance fixture"),
      });
      const revision = page.getByRole("dialog", { name: "Confirm Changes Application" });
      await expect(revision.getByRole("radio", { name: "Commit as New Revision" })).toBeChecked();
      await revision.getByRole("button", { name: "Confirm", exact: true }).click();
      const strip = page.getByTestId("files-tab-metadata-strip");
      await expect(strip.getByTestId("files-tab-version-pill")).toHaveText("v2", { timeout: 30_000 });
      await page.getByRole("button", { name: "Actions", exact: true }).click();
      await page.getByTestId("version-history-toggle").click();
      const history = page.getByTestId("file-version-history-panel");
      await expect(history).toBeVisible();
      await expect(history.getByTestId("version-row-2")).toBeVisible();
      await expect(history.getByTestId("version-row-1")).toBeVisible();
      await recordAudit("version-replace", "pass");
    } catch (error) {
      await recordAudit("version-replace", "fail", String(error).slice(0, 400));
      throw error;
    }
  });
});
