import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const e2eEmail = process.env.E2E_USER_EMAIL;
export const e2ePassword = process.env.E2E_USER_PASSWORD;
export const hasE2ECredentials = Boolean(e2eEmail && e2ePassword);

// SEC-L10: when the server is configured with E2E_AUTH_HMAC_SECRET, every
// request to /api/e2e/auth must carry a matching signature over
// `timestamp + "\n" + rawBody`. We sign here so Playwright keeps working
// whether or not CI enables the secondary gate.
function signE2EAuthRequest(rawBody: string): Record<string, string> {
  const secret = process.env.E2E_AUTH_HMAC_SECRET?.trim() ?? "";
  if (!secret) return {};
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\n${rawBody}`)
    .digest("hex");
  return {
    "x-e2e-timestamp": timestamp,
    "x-e2e-signature": signature,
  };
}

export async function login(page: Page): Promise<void> {
  const email = e2eEmail;
  const password = e2ePassword;
  if (!hasE2ECredentials || !email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for this test.");
  }

  const useE2EFallback =
    process.env.E2E_AUTH_FALLBACK === "1" || process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK === "1";

  if (useE2EFallback) {
    const rawBody = JSON.stringify({ email, password });
    const fallback = await page.request.post("/api/e2e/auth", {
      data: rawBody,
      headers: {
        "content-type": "application/json",
        ...signE2EAuthRequest(rawBody),
      },
    });
    if (fallback.ok()) {
      await page.goto("/hub");
      await expect
        .poll(async () => new URL(page.url()).pathname, { timeout: 15000 })
        .not.toBe("/login");
      return;
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    if (new URL(page.url()).pathname !== "/login") return;

    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 5000 });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    try {
      await expect
        .poll(async () => {
          const pathname = new URL(page.url()).pathname;
          if (pathname !== "/login") return "redirected";

          const errorBanner = page.locator("text=/invalid|error|too long|try again|failed/i").first();
          if (await errorBanner.isVisible().catch(() => false)) return "error";
          return "pending";
        }, { timeout: 35000 })
        .toBe("redirected");
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

export async function ensureLoggedOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
}
