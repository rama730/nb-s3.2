import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Module smoke matrix", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("auth session and module entry points load", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);
        const onboardingRequests: string[] = [];

        page.on("request", (request) => {
            const url = new URL(request.url());
            if (url.pathname === "/onboarding") {
                onboardingRequests.push(request.url());
            }
        });

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
            let response = await page.goto(route, { waitUntil: "domcontentloaded" });
            let status = response?.status() ?? 0;
            if (status >= 500) {
                response = await page.goto(route, { waitUntil: "domcontentloaded" });
                status = response?.status() ?? 0;
            }
            expect(status, `Expected a response for route: ${route}`).toBeGreaterThan(0);
            expect(status, `Route ${route} returned HTTP ${status}`).toBeLessThan(400);
        }

        expect(onboardingRequests).toEqual([]);

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
