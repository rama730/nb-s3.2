import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

function isCi() {
  return process.env.CI === "true";
}

function main() {
  const strict = isCi() || process.argv.includes("--strict");
  if (!strict) {
    console.log("[db-replay-env] advisory mode; pass --strict to require disposable replay configuration.");
    return;
  }

  const primary = process.env.DATABASE_URL?.trim() || "";
  const fresh = (
    process.env.DATABASE_URL_FRESH?.trim() ||
    process.env.DATABASE_URL_REPLAY_FRESH?.trim() ||
    ""
  );

  if (!primary) {
    throw new Error("DATABASE_URL is required for strict replay validation.");
  }
  if (!fresh) {
    throw new Error(
      "Strict replay requires DATABASE_URL_FRESH (or DATABASE_URL_REPLAY_FRESH).",
    );
  }
  if (fresh === primary) {
    throw new Error("DATABASE_URL_FRESH must be distinct from DATABASE_URL.");
  }

  console.log("[db-replay-env] strict replay env checks passed.");
}

try {
  main();
} catch (error) {
  console.error("[db-replay-env] failed:", error);
  process.exit(1);
}

export {};
