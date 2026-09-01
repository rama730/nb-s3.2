/** Scoped deployment: never replay unrelated migrations from the older database ledger. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const mode = process.argv[2];
if (!["--verify", "--apply"].includes(mode))
  throw new Error(
    "Use --verify (rollback checks) or --apply (only migration 0161)",
  );
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required; run node --env-file=.env.local scripts/deploy-reviewed-github-sync.mjs --verify",
  );
const tag = "0161_reviewed_github_sync";
const source = await readFile(
  new URL(`../drizzle/${tag}.sql`, import.meta.url),
  "utf8",
);
const checksum = createHash("sha256").update(source).digest("hex");
const hostname = new URL(process.env.DATABASE_URL).hostname;
const db = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  ssl: ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? false
    : "require",
});
const rollback = new Error("VERIFIED_ROLLBACK");
try {
  await db.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    await tx`SELECT pg_advisory_xact_lock(hashtext('nb-s3:migration-setup'))`;
    const [applied] =
      await tx`SELECT checksum,status FROM public.app_migration_journal WHERE tag=${tag}`;
    if (
      applied &&
      (applied.checksum !== checksum || applied.status !== "completed")
    )
      throw new Error(
        "Migration checksum/status differs; investigate before deploying",
      );
    if (!applied) {
      // PostgreSQL validates every dependency; any missing prerequisite rolls the entire migration back.
      await tx.unsafe(source);
      await tx`INSERT INTO public.app_migration_journal(tag,checksum,status,started_at,completed_at) VALUES (${tag},${checksum},'completed',now(),now())`;
    }
    const tables =
      await tx`SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.github_sync_connections'::regclass,'public.github_sync_runs'::regclass,'public.github_sync_files'::regclass,'public.github_contributor_identities'::regclass)`;
    assert.equal(tables.length, 4);
    assert.ok(tables.every((table) => table.relrowsecurity));
    const [access] =
      await tx`SELECT has_table_privilege('authenticated','public.github_sync_runs','SELECT') AS exposed`;
    assert.equal(access.exposed, false);
    if (mode === "--verify") {
      const [project] =
        await tx`SELECT id,owner_id FROM public.projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1`;
      if (!project)
        throw new Error(
          "A project fixture is required for the rollback-only attribution check",
        );
      const nodeId = randomUUID();
      await tx`INSERT INTO public.project_nodes(id,project_id,type,name,path,created_by) VALUES (${nodeId},${project.id},'file','sync-verification.txt',${`/sync-verification-${nodeId}.txt`},${project.owner_id})`;
      await tx`INSERT INTO public.file_versions(node_id,version,s3_key,size,mime_type,content_hash,uploaded_by) VALUES (${nodeId},1,${`${project.id}/sync-verification/${nodeId}`},1,'text/plain',${"a".repeat(64)},${project.owner_id})`;
      await tx`UPDATE public.file_versions SET content_hash=${"b".repeat(64)} WHERE node_id=${nodeId}`;
      await tx`UPDATE public.file_versions SET comment='metadata-only save' WHERE node_id=${nodeId}`;
      const [events] =
        await tx`SELECT count(*)::int AS count,count(DISTINCT sequence_number)::int AS sequences,bool_and(actor_id=${project.owner_id} AND metadata->>'source'='edge') AS attributed FROM public.project_node_events WHERE node_id=${nodeId} AND type='file_content_contributed'`;
      assert.deepEqual(events, { count: 2, sequences: 2, attributed: true });
      throw rollback;
    }
  });
  console.log(
    "Applied only 0161_reviewed_github_sync; historical migration entries were not changed.",
  );
} catch (error) {
  if (error === rollback)
    console.log(
      "PASS: migration SQL, private tables, content-change attribution, and unique sequences; all verification changes rolled back.",
    );
  else throw error;
} finally {
  await db.end();
}
