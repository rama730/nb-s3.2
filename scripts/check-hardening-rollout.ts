import fs from "node:fs";
import path from "node:path";

const ALLOWED_TARGETS = new Set([10, 50, 100]);
const ALLOWED_TRANSITIONS: Record<number, number> = {
  0: 10,
  10: 50,
  50: 100,
};

function parsePercent(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, received "${raw}"`);
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0 || normalized > 100) {
    throw new Error(`${name} must be between 0 and 100, received ${normalized}`);
  }
  return normalized;
}

function parseHours(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, received "${raw}"`);
  }
  return parsed;
}

function defaultStabilityWindowHours(targetPercent: number): number {
  if (targetPercent >= 100) return 72;
  return 24;
}

function readLastRunId(repoRoot: string): string {
  const runIdPath = path.join(repoRoot, ".e2e-last-run-id");
  if (!fs.existsSync(runIdPath)) {
    throw new Error(
      "missing .e2e-last-run-id. Run production E2E before rollout promotion checks.",
    );
  }
  const runId = fs.readFileSync(runIdPath, "utf8").trim();
  if (!runId) {
    throw new Error(".e2e-last-run-id is empty.");
  }
  return runId;
}

function validateStabilityWindow(now: Date, requiredHours: number) {
  const lastPromotionAtRaw = process.env.HARDENING_ROLLOUT_LAST_PROMOTION_AT;
  if (!lastPromotionAtRaw) {
    throw new Error(
      "HARDENING_ROLLOUT_LAST_PROMOTION_AT is required for promotion checks.",
    );
  }
  const lastPromotionAt = new Date(lastPromotionAtRaw);
  if (Number.isNaN(lastPromotionAt.getTime())) {
    throw new Error(
      `HARDENING_ROLLOUT_LAST_PROMOTION_AT must be an ISO date, received "${lastPromotionAtRaw}"`,
    );
  }
  const elapsedHours = (now.getTime() - lastPromotionAt.getTime()) / 3_600_000;
  if (elapsedHours < requiredHours) {
    throw new Error(
      `stability window not met (${elapsedHours.toFixed(2)}h < ${requiredHours}h).`,
    );
  }
}

function main() {
  const repoRoot = process.cwd();
  const targetPercent = parsePercent("HARDENING_ROLLOUT_TARGET_PERCENT", -1);
  const requireTarget =
    process.env.HARDENING_ROLLOUT_REQUIRE_TARGET === "1" ||
    process.env.HARDENING_ROLLOUT_REQUIRE_TARGET === "true";
  if (targetPercent < 0) {
    if (requireTarget) {
      throw new Error(
        "HARDENING_ROLLOUT_TARGET_PERCENT is required when HARDENING_ROLLOUT_REQUIRE_TARGET is enabled.",
      );
    }
    console.log("[hardening-rollout] no target set; skipping promotion checks.");
    return;
  }

  if (!ALLOWED_TARGETS.has(targetPercent)) {
    throw new Error(
      `HARDENING_ROLLOUT_TARGET_PERCENT must be one of ${Array.from(ALLOWED_TARGETS).join(", ")}.`,
    );
  }

  const currentPercent = parsePercent("HARDENING_ROLLOUT_CURRENT_PERCENT", 0);
  if (targetPercent <= currentPercent) {
    throw new Error(
      `target rollout ${targetPercent}% must be greater than current ${currentPercent}%.`,
    );
  }

  const expectedNext = ALLOWED_TRANSITIONS[currentPercent];
  if (expectedNext !== undefined && targetPercent !== expectedNext) {
    throw new Error(
      `invalid transition ${currentPercent}% -> ${targetPercent}%. Expected next: ${expectedNext}%.`,
    );
  }

  const requiredStabilityHours = parseHours(
    "HARDENING_ROLLOUT_STABILITY_HOURS",
    defaultStabilityWindowHours(targetPercent),
  );
  validateStabilityWindow(new Date(), requiredStabilityHours);
  const runId = readLastRunId(repoRoot);

  console.log("[hardening-rollout] promotion checks passed.");
  console.log(`[hardening-rollout] current=${currentPercent}% target=${targetPercent}%`);
  console.log(`[hardening-rollout] validated run id=${runId}`);
}

try {
  main();
} catch (error) {
  console.error("[hardening-rollout] failed:", error);
  process.exit(1);
}
