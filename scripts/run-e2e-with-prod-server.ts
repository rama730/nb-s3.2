#!/usr/bin/env tsx
/**
 * Starts the production server, waits for readiness, runs E2E tests, then stops the server.
 *
 * Usage:
 *   npm run build && E2E_SCOPE=critical tsx scripts/run-e2e-with-prod-server.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";

function resolveServerTarget() {
  const explicitPort = process.env.E2E_PORT;
  const envBaseURL = process.env.E2E_BASE_URL?.trim();

  if (!envBaseURL) {
    const port = explicitPort || "3100";
    return {
      port,
      baseURL: `http://localhost:${port}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(envBaseURL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid E2E_BASE_URL "${envBaseURL}": ${message}`);
  }

  const derivedPort =
    explicitPort ||
    parsed.port ||
    (parsed.protocol === "https:" ? "443" : "80");
  parsed.port = derivedPort;

  return {
    port: derivedPort,
    baseURL: parsed.toString().replace(/\/$/, ""),
  };
}

const { port, baseURL } = resolveServerTarget();
const readyURL = `${baseURL}/api/v1/ready`;
const timeoutMs = 120_000;
const pollMs = 500;
const perfDir = path.join(process.cwd(), "test-results", "perf");
const perfRunIdFile = path.join(process.cwd(), ".e2e-last-run-id");
const perfRunId =
  process.env.E2E_RUN_ID?.trim() ||
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let serverProcess: ChildProcess | null = null;
let shuttingDown = false;
let serverExitedUnexpectedly = false;

function killServerProcessTree(pid: number) {
  // On POSIX, kill the spawned process group (requires detached: true).
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      // Fall through to direct pid signal below.
    }
    try {
      process.kill(pid, "SIGTERM");
      return;
    } catch {
      // ignore
    }
    return;
  }

  // On Windows, use taskkill to terminate the process tree.
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
}

function killServer() {
  shuttingDown = true;
  if (serverProcess?.pid) {
    killServerProcessTree(serverProcess.pid);
    serverProcess = null;
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
  const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    console.error("[e2e] Missing production build. Run `npm run build` before prod E2E.");
    process.exit(1);
  }

  process.on("SIGINT", () => {
    killServer();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killServer();
    process.exit(143);
  });

  serverProcess = spawn("pnpm", ["exec", "next", "start", "-H", "0.0.0.0", "-p", port], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cwd: process.cwd(),
    env: process.env,
  });
  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    serverExitedUnexpectedly = true;
    console.error(`[e2e] Production server exited unexpectedly (code=${code}, signal=${signal})`);
  });

  const ready = await waitForReady();
  if (!ready || serverExitedUnexpectedly) {
    console.error("[e2e] Production server did not become ready in time");
    killServer();
    process.exit(1);
  }

  const playwrightArgs = process.argv.slice(2);
  try {
    fs.mkdirSync(path.dirname(perfRunIdFile), { recursive: true });
    fs.writeFileSync(perfRunIdFile, `${perfRunId}\n`, "utf8");

    const run = spawnSync("pnpm", ["exec", "playwright", "test", ...playwrightArgs], {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_BASE_URL: baseURL,
        E2E_USE_EXISTING_SERVER: "1",
        E2E_RUN_ID: perfRunId,
      },
    });
    if (run.error) {
      throw run.error;
    }
    if (typeof run.status === "number" && run.status !== 0) {
      throw new Error(`Playwright exited with status ${run.status}`);
    }
    if (run.signal) {
      throw new Error(`Playwright exited due to signal ${run.signal}`);
    }
    if (serverExitedUnexpectedly) {
      throw new Error("Production server exited unexpectedly during E2E run");
    }
    console.log(
      JSON.stringify({
        success: true,
        runId: perfRunId,
      }),
    );
  } finally {
    killServer();
  }
}

main().catch((err) => {
  console.error(err);
  killServer();
  process.exit(1);
});
