#!/usr/bin/env tsx
/**
 * Starts the dev server, waits for readiness, runs E2E tests, then stops the server.
 * Use when Playwright's built-in webServer has issues (e.g. Next.js compile delays).
 *
 * Usage: pnpm run test:e2e:with-server
 *        E2E_SCOPE=full pnpm run test:e2e:with-server
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const readyURL = `${baseURL}/api/v1/ready`;
const timeoutMs = 120_000;
const pollMs = 500;
const devServerMode = (process.env.E2E_DEV_SERVER_MODE || "webpack").toLowerCase();

let devProcess: ChildProcess | null = null;

function killDev() {
  if (devProcess?.pid) {
    try {
      process.kill(-devProcess.pid, "SIGTERM");
    } catch {
      // ignore
    }
    devProcess = null;
  }
}

async function waitForReady(): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(readyURL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

async function main() {
  process.on("SIGINT", () => {
    killDev();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killDev();
    process.exit(143);
  });

  const devCommand =
    devServerMode === "turbo"
      ? ["run", "dev"]
      : ["exec", "next", "dev", "--webpack", "-H", "0.0.0.0"];

  devProcess = spawn("pnpm", devCommand, {
    stdio: "ignore",
    detached: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_E2E_AUTH_FALLBACK:
        process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK || process.env.E2E_AUTH_FALLBACK || "1",
      E2E_AUTH_FALLBACK:
        process.env.E2E_AUTH_FALLBACK || process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK || "1",
    },
  });
  devProcess.unref();

  const ready = await waitForReady();
  if (!ready) {
    console.error("[e2e] Dev server did not become ready in time");
    killDev();
    process.exit(1);
  }

  const playwrightArgs = process.argv.slice(2).join(" ");
  const cmd = `pnpm exec playwright test${playwrightArgs ? ` ${playwrightArgs}` : ""}`;
  try {
    execSync(cmd, {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_USE_EXISTING_SERVER: "1",
        E2E_AUTH_FALLBACK:
          process.env.E2E_AUTH_FALLBACK || process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK || "1",
        NEXT_PUBLIC_E2E_AUTH_FALLBACK:
          process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK || process.env.E2E_AUTH_FALLBACK || "1",
      },
    });
  } finally {
    killDev();
  }
}

main().catch((err) => {
  console.error(err);
  killDev();
  process.exit(1);
});
