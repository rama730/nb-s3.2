// ============================================================================
// Task Panel Overhaul - Wave 4: @mention smoke
//
// Verifies the end-to-end mention loop in the task comment composer:
//   1. Typing `@` in the contentEditable composer opens the autocomplete.
//   2. Selecting a candidate inserts a mention chip.
//   3. Submitting the comment posts a payload whose `content` field carries
//      the canonical token format `@{uuid|DisplayName}` (proving the round
//      trip into the server action).
//
// The members endpoint is stubbed at the network layer so the test does not
// depend on real project membership. The task-panel URL is supplied via
// `E2E_TASK_PANEL_URL` (e.g. `/projects/<slug>/tasks/<taskId>?tab=comments`)
// and the test auto-skips when it is not set, matching the rest of the suite.
//
// To enable locally:
//   export E2E_USER_EMAIL=...
//   export E2E_USER_PASSWORD=...
//   export E2E_TASK_PANEL_URL=/projects/<slug>?taskId=<taskId>&tab=comments
//   pnpm test:e2e -- task-panel-mentions-smoke
// ============================================================================

import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

const taskPanelUrl = process.env.E2E_TASK_PANEL_URL;

const MOCK_MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_MEMBER_NAME = "Alice Smith";
const MOCK_MEMBER_USERNAME = "alice";

test.describe("Task panel @mention smoke", () => {
  test.skip(
    !hasE2ECredentials,
    "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.",
  );
  test.skip(
    !taskPanelUrl,
    "E2E_TASK_PANEL_URL must point at a task panel route with the comments tab open.",
  );

  test("typing @ inserts a mention chip and posts a token-shaped payload", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page, {
      monitorConsoleTypes: ["error", "warning"],
      allowedConsolePatterns: [
        /The result of getSnapshot should be cached to avoid an infinite loop/i,
      ],
    });

    // Stub the members API so the autocomplete returns a deterministic
    // single-row roster. Using `**/members*` so any project id matches.
    await page.route("**/api/v1/projects/*/members*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            members: [
              {
                id: MOCK_MEMBER_ID,
                username: MOCK_MEMBER_USERNAME,
                fullName: MOCK_MEMBER_NAME,
                avatarUrl: null,
                role: "member",
              },
            ],
          },
        }),
      });
    });

    // Capture the raw POST body so we can prove the token round-trip without
    // depending on a database read-back.
    const submittedBodies: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (
        request.method() === "POST" &&
        /\/api\/v1\/.*comments?|task-comment|task_comments/i.test(url)
      ) {
        submittedBodies.push(request.postData() ?? "");
      }
    });

    await login(page);
    await page.goto(taskPanelUrl as string, { waitUntil: "domcontentloaded" });

    // Composer is required for this test to be meaningful. If the URL did not
    // open the comments tab, fail loudly so the env var is fixed.
    const composer = page.getByTestId("mention-composer-editor").first();
    await expect(composer).toBeVisible({ timeout: 15000 });

    await composer.click();
    await composer.type("hi @ali");

    const autocomplete = page.getByTestId("mention-autocomplete");
    await expect(autocomplete).toBeVisible({ timeout: 5000 });

    const option = autocomplete
      .getByTestId("mention-autocomplete-option")
      .filter({ hasText: MOCK_MEMBER_NAME })
      .first();
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();

    // The chip is rendered as a contenteditable=false span with the
    // mention id stamped on the dataset attribute.
    const chip = composer.locator(`[data-mention-id="${MOCK_MEMBER_ID}"]`);
    await expect(chip).toBeVisible({ timeout: 5000 });
    await expect(chip).toHaveText(`@${MOCK_MEMBER_NAME}`);

    // Append a trailing word so we can verify the segment after the chip
    // round-trips as plain text.
    await composer.type(" please review");

    // Submit via Cmd/Ctrl+Enter (cross-platform friendly).
    await composer.press(
      process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
    );

    // Wait for at least one comment POST to land.
    await expect
      .poll(() => submittedBodies.length, { timeout: 10000 })
      .toBeGreaterThan(0);

    const expectedToken = `@{${MOCK_MEMBER_ID}|${MOCK_MEMBER_NAME}}`;
    const matched = submittedBodies.some(
      (body) => body.includes(expectedToken) && body.includes("please review"),
    );
    expect(
      matched,
      `Expected at least one POST body to contain the mention token "${expectedToken}". Got: ${JSON.stringify(submittedBodies)}`,
    ).toBe(true);

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
