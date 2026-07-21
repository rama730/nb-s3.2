import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { openRoute } from "./_helpers/navigation";

const ROUTES: Array<{ path: string; ready: string; checkHubHeader?: boolean }> = [
  { path: "/hub", ready: "[data-testid='hub-feed-scroll']", checkHubHeader: true },
  { path: "/workspace", ready: "[data-testid='workspace-route-scroll']" },
  { path: "/messages", ready: "[data-scroll-root='route']" },
  { path: "/people", ready: "[data-scroll-root='route']" },
  { path: "/profile", ready: "[data-scroll-root='route']" },
  { path: "/settings?tab=security", ready: "[data-scroll-root='route']" },
];

function visibleRouteRootCount() {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-root='route']"));
  return roots.filter((root) => {
    const style = window.getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }).length;
}

function scrollVisibleRouteRoot(scrollTop: number) {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-root='route']"));
  const root = roots.find((candidate) => {
    const style = window.getComputedStyle(candidate);
    const rect = candidate.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
  if (root) {
    root.scrollTop = Math.min(scrollTop, root.scrollHeight);
  }
}

test.describe("Scroll contract @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("enforces one route root and avoids page-level secondary scrolling", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);

    for (const route of ROUTES) {
      await openRoute(page, route.path, page.locator(route.ready));

      const markerCount = await page.evaluate(visibleRouteRootCount);
      expect(markerCount, `${route.path} should expose exactly one route scroll root`).toBe(1);

      const pageScrollDelta = await page.evaluate(() => {
        const root = document.scrollingElement;
        if (!root) return 0;
        return Math.max(0, root.scrollHeight - root.clientHeight);
      });
      expect(pageScrollDelta, `${route.path} should not rely on document-level scrolling`).toBeLessThanOrEqual(2);

      if (route.checkHubHeader) {
        const header = page.locator("[data-testid='hub-header-shell']").first();
        await expect(header).toBeVisible();

        const beforeTop = await header.evaluate((node) => node.getBoundingClientRect().top);
        await page.evaluate(scrollVisibleRouteRoot, 300);
        await page.waitForTimeout(100);
        const afterTop = await header.evaluate((node) => node.getBoundingClientRect().top);

        expect(Math.abs(beforeTop - afterTop), "Hub header should remain visually anchored during feed scroll").toBeLessThanOrEqual(2);
      }
    }

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
