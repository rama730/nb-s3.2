import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const disposableDatabaseUrl =
  process.env.DATABASE_URL_FRESH || process.env.DATABASE_URL_REPLAY_FRESH;

if (!disposableDatabaseUrl) {
  throw new Error(
    "Migration generation is blocked until DATABASE_URL_FRESH (or DATABASE_URL_REPLAY_FRESH) points to a disposable replay database.",
  );
}

if (process.env.DATABASE_URL && disposableDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("Migration generation must never replay against DATABASE_URL.");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const replay = spawnSync(npmCommand, ["run", "check:db:remigration-replay"], {
  stdio: "inherit",
  env: process.env,
});
if (replay.status !== 0) {
  throw new Error("Migration generation is blocked because disposable replay/catalog parity failed.");
}

const generate = spawnSync(npxCommand, ["drizzle-kit", "generate", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
if (generate.status !== 0) {
  throw new Error("drizzle-kit generate failed.");
}
