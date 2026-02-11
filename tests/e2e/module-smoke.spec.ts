import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasE2ECredentials = !!email && !!password;

async function login(page: import("@playwright/test").Page) {
    if (!hasE2ECredentials || !email || !password) {
        throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for this test.");
    }

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/hub", { timeout: 30000 });
}

test.describe("Module smoke matrix", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("auth session and module entry points load", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await login(page);

        await page.goto("/hub");
        const firstCard = page.locator("[data-testid^='project-card-']").first();
        await expect(firstCard).toBeVisible();
        const projectHref = await firstCard.locator("a[href^='/projects/']").first().getAttribute("href");
        expect(projectHref).toBeTruthy();

        const routesToCheck = [
            "/profile",
            "/people",
            "/messages",
            projectHref!,
            `${projectHref!}?tab=tasks`,
            `${projectHref!}?tab=files`,
        ];

        for (const route of routesToCheck) {
            const response = await page.goto(route, { waitUntil: "domcontentloaded" });
            const status = response?.status() ?? 0;
            expect(status).toBeGreaterThan(0);
            expect(status).toBeLessThan(400);
        }

        await context.close();
    });
});
