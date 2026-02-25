import { execSync } from "node:child_process";

let seeded = false;

export const e2eRunId =
  process.env.E2E_RUN_ID || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function scopedName(prefix: string): string {
  return `${prefix}-${e2eRunId}-${Date.now()}`;
}

export function ensureE2EFixtures(): void {
  if (seeded || process.env.E2E_SKIP_SEED === "1") return;

  const env = { ...process.env, E2E_RUN_ID: e2eRunId };
  execSync("pnpm run -s seed:e2e:fixtures", {
    env,
    stdio: "inherit",
  });
  seeded = true;
}

export function cleanupE2EFixtures(): void {
  if (process.env.E2E_SKIP_CLEANUP === "1") return;

  try {
    execSync("pnpm run -s cleanup:e2e:fixtures", {
      env: { ...process.env, E2E_RUN_ID: e2eRunId },
      stdio: "inherit",
    });
  } catch (error) {
    // Cleanup is best effort to avoid masking test outcomes.
    console.warn("[e2e] cleanup failed", error);
  }
}
