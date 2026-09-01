/** Read-only smoke check against the configured E2E user's existing project. Never creates a repository or sync run. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import postgres from "postgres";

if (
  !process.env.E2E_USER_EMAIL ||
  !process.env.E2E_USER_PASSWORD ||
  !process.env.DATABASE_URL
)
  throw new Error("An existing E2E account and DATABASE_URL are required");
const db = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: "require",
});
const [project] =
  await db`SELECT p.slug,p.id FROM projects p JOIN auth.users u ON u.id=p.owner_id WHERE u.email=${process.env.E2E_USER_EMAIL} AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1`;
await db.end();
if (!project)
  throw new Error(
    "The configured E2E account needs an existing owned project; no fixture was created",
  );
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const base = process.env.E2E_BASE_URL || "http://localhost:3000";
  await page.goto(`${base}/login`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(process.env.E2E_USER_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 45000 });
  await page.goto(
    `${base}/projects/${project.slug || project.id}?tab=files&filesView=github`,
  );
  const githubNavigation = page.getByRole("button", {
    name: "GitHub Sync",
    exact: true,
  });
  const workspace = page.getByRole("region", {
    name: "GitHub synchronization workspace",
  });
  await page.waitForTimeout(1500);
  if ((await githubNavigation.count()) === 0) {
    assert.equal(
      await workspace.count(),
      0,
      "GitHub Sync stays hidden when the account has no linked GitHub identity",
    );
    assert.equal(
      new URL(page.url()).searchParams.get("filesView"),
      null,
      "an unavailable direct GitHub view falls back to Project files",
    );
    console.log(
      "PASS: unlinked GitHub collection is hidden and direct navigation safely falls back.",
    );
    process.exitCode = 0;
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  } else {
    await workspace.waitFor({ state: "visible", timeout: 60000 });
    assert.equal(
      await workspace.getByRole("alert").count(),
      0,
      "Workspace server actions should return without SQL/auth errors",
    );
    await githubNavigation.waitFor({ state: "visible" });
    assert.equal(
      await page.locator('[role="dialog"]').count(),
      0,
      "Sync must render inline, not in a drawer",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const create = page.getByRole("button", { name: /Create a repository/ });
    if (await create.count()) {
      await create.click();
      assert.equal(
        await page.getByRole("checkbox", { name: /private/i }).isChecked(),
        true,
      );
    } else {
      assert.ok(
        (await page
          .getByText(
            /Connected|Restore repository permission|GitHub access needs attention/,
          )
          .count()) > 0,
        "A linked account shows setup, connected, or restore-access state",
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "/private/tmp/github-sync-mobile-smoke.png",
      fullPage: true,
    });
    console.log(
      "PASS: conditional GitHub collection, state-driven setup/connection, private-new-repository default, desktop/mobile overflow. No sync operation executed.",
    );
  }
} finally {
  await browser.close();
}
