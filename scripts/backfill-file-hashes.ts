/**
 * One-off backfill: populate `file_versions.content_hash` for rows seeded by
 * migration 0069. Those rows were created without computing SHA-256 (the
 * migration only copies metadata from `project_nodes`), so re-upload detection
 * for legacy files would miss the "same bytes" case until this script runs.
 *
 * Strategy
 *   1. Select file_versions rows where content_hash IS NULL and s3_key != ''.
 *   2. For each, stream the blob from Supabase Storage (bucket `project-files`)
 *      via the admin client, compute SHA-256 with the runtime's crypto module.
 *   3. Write the lowercase hex digest back via a parameterized UPDATE.
 *
 * Safety
 *   • Runs in batches of 25, with a short inter-batch pause, to avoid storage
 *     throttling on large projects.
 *   • Idempotent: re-running skips already-hashed rows.
 *   • On per-file error, logs and continues; a final summary reports counts.
 *
 * Usage
 *   pnpm tsx scripts/backfill-file-hashes.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("localhost", "127.0.0.1");
}

import { createHash } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { fileVersions } from "../src/lib/db/schema";
import { createAdminClient } from "../src/lib/supabase/server";

const BUCKET = "project-files";
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 200;

type Row = {
  id: string;
  nodeId: string;
  s3Key: string;
};

async function fetchBatch(): Promise<Row[]> {
  const rows = await db
    .select({
      id: fileVersions.id,
      nodeId: fileVersions.nodeId,
      s3Key: fileVersions.s3Key,
    })
    .from(fileVersions)
    .where(
      and(
        isNull(fileVersions.contentHash),
        ne(fileVersions.s3Key, ""),
      ),
    )
    .limit(BATCH_SIZE);
  return rows;
}

async function hashBlob(admin: Awaited<ReturnType<typeof createAdminClient>>, s3Key: string) {
  const { data, error } = await admin.storage.from(BUCKET).download(s3Key);
  if (error || !data) {
    throw new Error(`download failed: ${error?.message ?? "no data"}`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  console.log("[backfill-file-hashes] starting…");
  const admin = await createAdminClient();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let guard = 0; guard < 10_000; guard++) {
    const batch = await fetchBatch();
    if (batch.length === 0) break;

    for (const row of batch) {
      processed++;
      try {
        const digest = await hashBlob(admin, row.s3Key);
        await db
          .update(fileVersions)
          .set({ contentHash: digest })
          .where(eq(fileVersions.id, row.id));
        succeeded++;
      } catch (err) {
        failed++;
        console.warn(
          `[backfill-file-hashes] failed id=${row.id} node=${row.nodeId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    if (batch.length < BATCH_SIZE) break;
  }

  console.log(
    `[backfill-file-hashes] done. processed=${processed} succeeded=${succeeded} failed=${failed}`,
  );
  // Sanity probe — any stragglers left?
  const [{ remaining }] = await db.execute<{ remaining: number }>(
    sql`SELECT COUNT(*)::int AS remaining FROM file_versions WHERE content_hash IS NULL AND s3_key <> ''`,
  );
  console.log(`[backfill-file-hashes] remaining NULL hashes: ${remaining}`);

  process.exit(failed > 0 && succeeded === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill-file-hashes] fatal:", err);
  process.exit(1);
});
