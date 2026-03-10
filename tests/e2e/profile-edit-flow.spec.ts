import { expect, test, type Page } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";

async function openEditModal(page: Page) {
    const dialog = page.getByRole("dialog");
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const editButton = page.getByRole("button", { name: "Edit Profile" }).first();
        await expect(editButton).toBeVisible();
        await editButton.click();
        try {
            await expect(dialog).toContainText("Edit Profile", { timeout: 5000 });
            return dialog;
        } catch (error) {
            if (attempt === 2) throw error;
        }
    }
    return dialog;
}

test.describe("Profile edit flow", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("profile page loads and headline edit persists", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);

        await login(page);
        await page.goto("/profile");
        await expect(page).toHaveURL(/\/profile$/);

        const editModal = await openEditModal(page);
        const headlineInput = editModal.getByPlaceholder("e.g. Senior Frontend Engineer");
        await expect(headlineInput).toBeVisible();

        const originalHeadline = await headlineInput.inputValue();
        const updatedHeadline = scopedName("E2E-headline");
        await headlineInput.fill(updatedHeadline);
        const saveButton = editModal.getByRole("button", { name: "Save Changes" });
        await expect(saveButton).toBeEnabled();
        const saveResponse = page.waitForResponse(
            (response) =>
                response.request().method() === "POST" &&
                response.url().includes("/profile") &&
                (response.request().postData() || "").includes(updatedHeadline),
            { timeout: 30000 }
        );
        await saveButton.click();
        const settledSaveResponse = await saveResponse;
        expect(settledSaveResponse.status()).toBe(200);
        const contentType = settledSaveResponse.headers()["content-type"] || "";
        if (contentType.includes("application/json")) {
            const payload = await settledSaveResponse.json();
            expect(payload?.success).toBeTruthy();
        }
        await expect(editModal).toBeHidden({ timeout: 15000 });

        await page.reload({ waitUntil: "domcontentloaded" });
        const verifyModal = await openEditModal(page);
        const verifyHeadlineInput = verifyModal.getByPlaceholder("e.g. Senior Frontend Engineer");
        await expect(verifyHeadlineInput).toHaveValue(updatedHeadline);

        await verifyHeadlineInput.fill(originalHeadline);
        const restoreButton = verifyModal.getByRole("button", { name: "Save Changes" });
        await expect(restoreButton).toBeEnabled();
        await restoreButton.click();
        await expect(verifyModal).toBeHidden({ timeout: 15000 });

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
