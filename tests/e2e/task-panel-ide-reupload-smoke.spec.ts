// ============================================================================
// Task Panel Overhaul - Wave 2: Open-in-IDE + re-upload smoke
//
// Verifies the protocol-handler launch path:
//   1. Clicking the "Open" trigger on a file row opens the IDE chooser menu.
//   2. Selecting "Open in Cursor" routes through `launchIdeUrl`, which the
//      test intercepts via the `__nbIdeLaunchHook` seam (see
//      `src/lib/files/ide-launcher.ts`). We assert the captured URL has the
//      shape `cursor://file/<absolutePath>` so the contract between the
//      composer and the OS handler is preserved.
//
// Because Playwright cannot drive a real desktop IDE, the re-upload arm of
// the loop (drop file back, hash compare, "Save as new version" dialog) is
// covered by `tests/unit/task-file-intelligence.test.ts`. This spec proves
// only that the launch arm reaches the protocol handler with a well-formed
// URL — that is the part Playwright can observe deterministically.
//
// To enable locally:
//   export E2E_USER_EMAIL=...
//   export E2E_USER_PASSWORD=...
//   export E2E_TASK_PANEL_FILES_URL=/projects/<slug>?taskId=<taskId>&tab=files
//   pnpm test:e2e -- task-panel-ide-reupload-smoke
//
// The fixture must have at least one file attached to the task so the
// `OpenInIdeMenu` trigger is rendered.
// ============================================================================

import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

const filesUrl = process.env.E2E_TASK_PANEL_FILES_URL;

test.describe("Task panel open-in-IDE smoke", () => {
  test.skip(
    !hasE2ECredentials,
    "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
  );
  test.skip(
    !filesUrl,
    "E2E_TASK_PANEL_FILES_URL must point at a task panel route with the files tab open and at least one file attached.",
  );

  test("Open in Cursor routes through the protocol handler with a cursor:// URL", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      monitorConsoleTypes: ["error", "warning"],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
      ],
    });

    // Install the test seam BEFORE the app boots. Every IDE launch routed
    // through `launchIdeUrl` will push its URL into `window.__nbIdeLaunchUrls`
    // instead of poking an iframe (production behaviour). The hook returns
    // void so the launcher can keep its fire-and-forget contract.
    await page.addInitScript(() => {
      const captured: string[] = [];
      (window as unknown as {
        __nbIdeLaunchUrls: string[];
        __nbIdeLaunchHook: (url: string) => void;
      }).__nbIdeLaunchUrls = captured;
      (window as unknown as {
        __nbIdeLaunchHook: (url: string) => void;
      }).__nbIdeLaunchHook = (url: string) => {
        captured.push(url);
      };
    });

    // Skip the localStorage prompt for the OS username so the launch flow does
    // not block on a confirm() dialog. The launcher caches under "nb.user".
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("nb.user", "playwright");
      } catch {
        // localStorage may be unavailable in some contexts; non-fatal.
      }
    });

    await login(page);
    await page.goto(filesUrl as string, { waitUntil: "domcontentloaded" });

    const trigger = page.getByTestId("open-in-ide-trigger").first();
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await trigger.click();

    const menu = page.getByTestId("open-in-ide-menu");
    await expect(menu).toBeVisible({ timeout: 5000 });

    // All four chooser options should be present.
    await expect(menu.getByTestId("open-in-ide-cursor")).toBeVisible();
    await expect(menu.getByTestId("open-in-ide-vscode")).toBeVisible();
    await expect(menu.getByTestId("open-in-ide-workspace")).toBeVisible();
    await expect(menu.getByTestId("open-in-ide-download")).toBeVisible();

    await menu.getByTestId("open-in-ide-cursor").click();

    // The launcher fires asynchronously after the signed URL is fetched and
    // the file is downloaded. Poll for the captured URL.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __nbIdeLaunchUrls?: string[] })
                .__nbIdeLaunchUrls?.length ?? 0,
          ),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);

    const launched = await page.evaluate(
      () =>
        (window as unknown as { __nbIdeLaunchUrls?: string[] })
          .__nbIdeLaunchUrls ?? [],
    );
    expect(
      launched.some((url) => url.startsWith("cursor://file/")),
      `Expected at least one cursor:// launch URL. Got: ${JSON.stringify(launched)}`,
    ).toBe(true);

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
