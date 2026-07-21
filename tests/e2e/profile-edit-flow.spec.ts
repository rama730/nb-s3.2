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
        const monitor = attachPageMonitoring(page, {
            monitorConsoleTypes: ["error", "warning"],
            allowedConsolePatterns: [/was preloaded using link preload but not used/i],
        });

        await login(page);
        await page.goto("/profile");
        await expect(page).toHaveURL(/\/profile$/);

        const pageHeading = page.getByRole("heading", { level: 1 }).first();
        await expect(pageHeading).toBeVisible();
        const headingText = ((await pageHeading.textContent()) || "").trim();
        await expect(page).toHaveTitle(new RegExp(headingText, "i"));

        await page.getByRole("tab", { name: /Portfolio/i }).click();
        await expect(page).toHaveURL(/\/profile\?tab=portfolio$/);
        await expect(page.getByRole("tabpanel", { name: /Portfolio/i })).toBeVisible();

        await page.getByRole("tab", { name: /Overview/i }).click();
        await expect(page).toHaveURL(/\/profile$/);
        await expect(page.getByRole("tabpanel", { name: /Overview/i })).toBeVisible();
        const skillsHeading = page.getByRole("heading", { name: "Skills", exact: true });
        const rolesHeading = page.getByRole("heading", { name: "Open to Roles", exact: true });
        await expect(skillsHeading).toBeVisible();
        await expect(rolesHeading).toBeVisible();
        const skillsBox = await skillsHeading.boundingBox();
        const rolesBox = await rolesHeading.boundingBox();
        expect(skillsBox).not.toBeNull();
        expect(rolesBox).not.toBeNull();
        expect(skillsBox!.y).toBeLessThan(rolesBox!.y);
        await expect(page.getByText("Current availability", { exact: true })).toHaveCount(0);

        const editModal = await openEditModal(page);
        await expect(editModal.locator("form[aria-label='Edit profile form']")).toBeVisible();
        await expect(editModal.locator("[data-slot='dialog-description']")).toHaveCount(1);
        await expect(editModal.getByLabel("Full Name")).toBeVisible();
        await expect(editModal.getByLabel("Username")).toBeVisible();
        await expect(editModal.getByText("Availability Status", { exact: true })).toHaveCount(0);
        await editModal.getByRole("tab", { name: "Skills & Expertise" }).click();
        await expect(editModal.getByRole("heading", { name: "Open to Roles" })).toBeVisible();
        await expect(editModal.getByText("Weekly capacity", { exact: true })).toBeVisible();
        await editModal.getByRole("tab", { name: "General Properties" }).click();
        const cancelType = await editModal.getByRole("button", { name: "Cancel" }).getAttribute("type");
        const saveType = await editModal.getByRole("button", { name: "Save Changes" }).getAttribute("type");
        expect(cancelType).toBe("button");
        expect(saveType).toBe("submit");

        const headlineInput = editModal.getByLabel("Headline");
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

        const connectionButton = page.getByRole("button", { name: /Connection/i }).first();
        await connectionButton.click();
        await expect(page.getByRole("dialog", { name: /Connections/i })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: /Connections/i })).toBeHidden({ timeout: 15000 });

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });

    test("profile keeps skills and role preferences visible in the mobile content order", async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();

        await login(page);
        await page.goto("/profile");

        const about = page.getByRole("heading", { name: "About", exact: true });
        const skills = page.getByRole("heading", { name: "Skills", exact: true });
        const roles = page.getByRole("heading", { name: "Open to Roles", exact: true });
        const contributions = page.getByRole("heading", { name: "Project Contributions", exact: true });
        await expect(about).toBeVisible();
        await expect(skills).toBeVisible();
        await expect(roles).toBeVisible();
        await expect(contributions).toBeVisible();

        const positions = await Promise.all([about, skills, roles, contributions].map(async (locator) => (await locator.boundingBox())!.y));
        expect(positions).toEqual([...positions].sort((left, right) => left - right));

        await context.close();
    });

    test("project contribution visibility persists for owner and public profile readers", async ({ browser }) => {
        const ownerContext = await browser.newContext();
        const ownerPage = await ownerContext.newPage();
        const contributionName = scopedName("E2E-external-contribution");

        await login(ownerPage);
        await ownerPage.goto("/profile");
        const handleNode = ownerPage.locator("text=/@[-_a-zA-Z0-9]+/").first();
        await expect(handleNode).toBeVisible({ timeout: 15000 });
        const username = ((await handleNode.textContent()) || "").trim().replace(/^@/, "");
        expect(username).not.toBe("");

        const createDialog = await openEditModal(ownerPage);
        await createDialog.getByRole("tab", { name: "Project Contributions" }).click();
        await createDialog.getByRole("button", { name: "Add external project" }).click();
        await createDialog.getByLabel("Project name").fill(contributionName);
        await createDialog.getByLabel("Your role").fill("Contributor");
        const privateSwitch = createDialog.getByRole("switch", { name: new RegExp(contributionName) });
        await expect(privateSwitch).toHaveAttribute("aria-checked", "false");
        await createDialog.getByRole("button", { name: "Save Changes" }).click();
        await expect(createDialog).toBeHidden({ timeout: 15000 });
        await expect(ownerPage.getByText(contributionName, { exact: true })).toBeVisible();

        const publicContext = await browser.newContext();
        const publicPage = await publicContext.newPage();
        await publicPage.goto(`/u/${encodeURIComponent(username)}`);
        await expect(publicPage.getByText(contributionName, { exact: true })).toHaveCount(0);

        const publicDialog = await openEditModal(ownerPage);
        await publicDialog.getByRole("tab", { name: "Project Contributions" }).click();
        await publicDialog.getByRole("button", { name: new RegExp(contributionName) }).click();
        const showSwitch = publicDialog.getByRole("switch", { name: new RegExp(contributionName) });
        await showSwitch.click();
        await expect(showSwitch).toHaveAttribute("aria-checked", "true");
        await publicDialog.getByRole("button", { name: "Save Changes" }).click();
        await expect(publicDialog).toBeHidden({ timeout: 15000 });

        await publicPage.reload({ waitUntil: "domcontentloaded" });
        await expect(publicPage.getByText(contributionName, { exact: true })).toBeVisible({ timeout: 15000 });

        const hideDialog = await openEditModal(ownerPage);
        await hideDialog.getByRole("tab", { name: "Project Contributions" }).click();
        await hideDialog.getByRole("button", { name: new RegExp(contributionName) }).click();
        const hideSwitch = hideDialog.getByRole("switch", { name: new RegExp(contributionName) });
        await hideSwitch.click();
        await expect(hideSwitch).toHaveAttribute("aria-checked", "false");
        await hideDialog.getByRole("button", { name: "Save Changes" }).click();
        await expect(hideDialog).toBeHidden({ timeout: 15000 });

        await publicPage.reload({ waitUntil: "domcontentloaded" });
        await expect(publicPage.getByText(contributionName, { exact: true })).toHaveCount(0);

        const cleanupDialog = await openEditModal(ownerPage);
        await cleanupDialog.getByRole("tab", { name: "Project Contributions" }).click();
        await cleanupDialog.getByRole("button", { name: new RegExp(contributionName) }).click();
        await cleanupDialog.getByRole("button", { name: "Remove" }).click();
        await cleanupDialog.getByRole("button", { name: "Save Changes" }).click();
        await expect(cleanupDialog).toBeHidden({ timeout: 15000 });
        await expect(ownerPage.getByText(contributionName, { exact: true })).toHaveCount(0);

        await publicContext.close();
        await ownerContext.close();
    });
});
