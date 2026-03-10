function isCi() {
  return process.env.CI === "true";
}

function main() {
  if (!isCi()) {
    console.log("[db-replay-env] non-CI environment; skipping strict replay env checks.");
    return;
  }

  const primary = process.env.DATABASE_URL?.trim() || "";
  const fresh = (
    process.env.DATABASE_URL_FRESH?.trim() ||
    process.env.DATABASE_URL_REPLAY_FRESH?.trim() ||
    ""
  );

  if (!primary) {
    throw new Error("DATABASE_URL is required in CI.");
  }
  if (!fresh) {
    throw new Error(
      "CI requires DATABASE_URL_FRESH (or DATABASE_URL_REPLAY_FRESH) for strict fresh replay.",
    );
  }
  if (fresh === primary) {
    throw new Error("DATABASE_URL_FRESH must be distinct from DATABASE_URL in CI.");
  }

  console.log("[db-replay-env] strict CI replay env checks passed.");
}

try {
  main();
} catch (error) {
  console.error("[db-replay-env] failed:", error);
  process.exit(1);
}
