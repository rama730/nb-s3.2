import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const useExistingServer = process.env.E2E_USE_EXISTING_SERVER === "1";
const parsedWorkers = Number(process.env.E2E_WORKERS || "1");
const workers = Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? Math.floor(parsedWorkers) : 1;
const scope = process.env.E2E_SCOPE || "full";
const browserMatrix = process.env.E2E_BROWSER_MATRIX || "gate";
const devServerMode = (process.env.E2E_DEV_SERVER_MODE || "webpack").toLowerCase();
if (!process.env.E2E_RUN_ID) {
    process.env.E2E_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const retries = 1;

const projects = browserMatrix === "nightly"
    ? [
        { name: "chromium", use: { browserName: "chromium" as const } },
        { name: "firefox", use: { browserName: "firefox" as const } },
        { name: "webkit", use: { browserName: "webkit" as const } },
    ]
    : [{ name: "chromium", use: { browserName: "chromium" as const } }];

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 120_000,
    workers,
    retries,
    globalSetup: "./tests/e2e/_helpers/global-setup.ts",
    globalTeardown: "./tests/e2e/_helpers/global-teardown.ts",
    projects,
    grep: scope === "critical" ? /@critical|smoke|matrix|flow/i : undefined,
    expect: {
        timeout: 10_000,
    },
    use: {
        baseURL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: useExistingServer
        ? undefined
        : {
            command:
                devServerMode === "turbo"
                    ? "pnpm run dev"
                    : "pnpm exec next dev --webpack -H 0.0.0.0",
            url: `${baseURL}/api/v1/ready`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            stdout: "ignore",
            stderr: "pipe",
            env: {
                ...process.env,
                ONBOARDING_USERNAME_CHECK_LIMIT: process.env.ONBOARDING_USERNAME_CHECK_LIMIT || "8",
                ONBOARDING_USERNAME_CHECK_WINDOW_SECONDS: process.env.ONBOARDING_USERNAME_CHECK_WINDOW_SECONDS || "60",
                NEXT_PUBLIC_E2E_AUTH_FALLBACK:
                    process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK ||
                    process.env.E2E_AUTH_FALLBACK ||
                    "0",
            },
        },
});
