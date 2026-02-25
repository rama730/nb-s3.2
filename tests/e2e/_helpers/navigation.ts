import { expect, type Locator, type Page } from "@playwright/test";

export async function openRoute(
  page: Page,
  route: string,
  readyLocator?: Locator,
): Promise<void> {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  const status = response?.status() ?? 0;
  expect(status, `Expected a valid response for route: ${route}`).toBeGreaterThan(0);
  expect(status, `Route ${route} returned HTTP ${status}`).toBeLessThan(400);
  if (readyLocator) {
    await expect(readyLocator).toBeVisible({ timeout: 15000 });
  }
}

export async function waitForNoBlockingLoader(page: Page): Promise<void> {
  const blocking = page
    .locator('[aria-busy="true"], .animate-spin, [data-testid="global-loading"]')
    .first();
  if (await blocking.count()) {
    await expect(blocking).toHaveCount(0, { timeout: 15000 });
  }
}
