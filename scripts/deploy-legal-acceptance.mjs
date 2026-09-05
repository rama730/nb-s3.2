/** Scoped deployment: never replay unrelated migrations from the older database ledger. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const mode = process.argv[2];
if (!["--verify", "--apply"].includes(mode)) {
  throw new Error("Use --verify (rollback checks) or --apply (only migration 0162)");
}
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required; run npm run deploy:legal:verify before applying",
  );
}

const tag = "0162_legal_acceptances";
const source = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const hostname = new URL(process.env.DATABASE_URL).hostname;
const db = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  ssl: ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? false : "require",
});
const rollback = new Error("VERIFIED_ROLLBACK");

try {
  await db.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    await tx`SELECT pg_advisory_xact_lock(hashtext('nb-s3:migration-setup'))`;

    const [applied] =
      await tx`SELECT checksum,status FROM public.app_migration_journal WHERE tag=${tag}`;
    if (applied && (applied.checksum !== checksum || applied.status !== "completed")) {
      throw new Error("Migration checksum/status differs; investigate before deploying");
    }
    if (!applied) {
      await tx.unsafe(source);
      await tx`INSERT INTO public.app_migration_journal(tag,checksum,status,started_at,completed_at) VALUES (${tag},${checksum},'completed',now(),now())`;
    }

    const [table] = await tx`
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = 'public.legal_acceptances'::regclass
    `;
    assert.equal(table.relrowsecurity, true);

    const [access] = await tx`
      SELECT
        has_table_privilege('anon','public.legal_acceptances','SELECT') AS anon_select,
        has_table_privilege('authenticated','public.legal_acceptances','SELECT') AS authenticated_select
    `;
    assert.deepEqual(access, { anon_select: false, authenticated_select: false });

    const [retention] = await tx`
      SELECT
        COUNT(*) FILTER (WHERE legal_retention_until IS NULL)::int AS missing,
        COUNT(*) FILTER (WHERE legal_retention_until < hard_delete_at)::int AS invalid
      FROM public.account_deletions
    `;
    assert.deepEqual(retention, { missing: 0, invalid: 0 });

    if (mode === "--verify") throw rollback;
  });
  console.log("Applied only 0162_legal_acceptances; historical migration entries were not changed.");
} catch (error) {
  if (error === rollback) {
    console.log("PASS: migration SQL, private acceptance evidence, RLS, and retention checks; verification changes rolled back.");
  } else {
    throw error;
  }
} finally {
  await db.end();
}
