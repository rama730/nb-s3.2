import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const useExistingServer = process.env.E2E_USE_EXISTING_SERVER === "1";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 120_000,
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
            command: "npm run dev",
            url: baseURL,
            reuseExistingServer: true,
            timeout: 120_000,
        },
});
