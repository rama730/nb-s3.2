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

function parseCount(text: string | null): number {
    if (!text) return 0;
    const value = Number(text.replace(/[^\d]/g, ""));
    return Number.isNaN(value) ? 0 : value;
}

test.describe("Project views and followers flow", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("open detail, new tab, follow/unfollow from hub and detail", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        await login(page);

        await page.goto("/hub");
        const firstCard = page.locator("[data-testid^='project-card-']").first();
        await expect(firstCard).toBeVisible();
        const projectId = (await firstCard.getAttribute("data-project-id")) || "";

        const followButton = page.locator(`[data-testid="project-card-follow-${projectId}"]`);
        await firstCard.hover();
        await expect(followButton).toBeVisible();

        const followersBadge = page.locator(`[data-testid="project-card-followers-${projectId}"]`);
        const hubFollowersBefore = parseCount(await followersBadge.textContent());
        await followButton.click();
        await firstCard.hover();
        await expect.poll(async () => parseCount(await followersBadge.textContent())).not.toBe(hubFollowersBefore);
        const hubFollowersAfter = parseCount(await followersBadge.textContent());

        const projectLink = firstCard.locator("a[href^='/projects/']").first();
        await projectLink.click();
        await page.waitForURL(/\/projects\//);

        const detailFollowers = page.locator("[data-testid='project-followers-count'] span");
        const detailViewCount = page.locator("[data-testid='project-view-count'] span");
        await expect(detailFollowers).toBeVisible();
        await expect(detailViewCount).toBeVisible();

        const detailFollowersValue = parseCount(await detailFollowers.textContent());
        expect(detailFollowersValue).toBe(hubFollowersAfter);

        const viewCountBefore = parseCount(await detailViewCount.textContent());
        const newTab = await context.newPage();
        await newTab.goto(page.url());
        await expect(newTab.locator("[data-testid='project-view-count'] span")).toBeVisible();
        const viewCountSameSession = parseCount(
            await newTab.locator("[data-testid='project-view-count'] span").textContent()
        );
        expect(viewCountSameSession).toBe(viewCountBefore);

        const newContext = await browser.newContext();
        const freshPage = await newContext.newPage();
        await login(freshPage);
        await freshPage.goto(page.url());
        await expect(freshPage.locator("[data-testid='project-view-count'] span")).toBeVisible();
        const viewCountFresh = parseCount(
            await freshPage.locator("[data-testid='project-view-count'] span").textContent()
        );
        expect(viewCountFresh).toBeGreaterThanOrEqual(viewCountBefore + 1);

        const detailFollowToggle = page.locator("[data-testid='project-follow-toggle']");
        const detailFollowersBeforeToggle = parseCount(await detailFollowers.textContent());
        await detailFollowToggle.click();
        await expect.poll(async () => parseCount(await detailFollowers.textContent())).not.toBe(detailFollowersBeforeToggle);

        await page.goto("/hub");
        const hubFollowersFinalBadge = page.locator(`[data-testid="project-card-followers-${projectId}"]`);
        await firstCard.hover();
        await expect(hubFollowersFinalBadge).toBeVisible();
        const hubFollowersFinal = parseCount(await hubFollowersFinalBadge.textContent());
        expect(hubFollowersFinal).toBe(parseCount(await detailFollowers.textContent()));

        await context.close();
        await newContext.close();
    });
});
