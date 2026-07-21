import assert from "node:assert/strict";

import * as dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

async function main(connectionString: string) {
  const sql = postgres(connectionString, { prepare: false, ssl: "require" });
  try {
  const [candidate] = await sql<{
    userId: string;
    allowedProjectId: string;
    deniedProjectId: string;
    deniedProjectVisibility: string;
  }[]>`
    SELECT
      pm.user_id AS "userId",
      pm.project_id AS "allowedProjectId",
      target.id AS "deniedProjectId",
      target.visibility AS "deniedProjectVisibility"
    FROM public.project_members pm
    CROSS JOIN LATERAL (
      SELECT p.id, p.visibility
      FROM public.projects p
      WHERE p.id <> pm.project_id
        AND p.owner_id <> pm.user_id
        AND p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.project_members membership
          WHERE membership.project_id = p.id
            AND membership.user_id = pm.user_id
        )
        AND EXISTS (
          SELECT 1
          FROM public.project_nodes node
          WHERE node.project_id = p.id
        )
      LIMIT 1
    ) target
    LIMIT 1
  `;

  assert(candidate, "No private cross-project authorization fixture is available");

  const result = await sql.begin(async (tx) => {
    const transaction = tx as unknown as typeof sql;
    await transaction`
      UPDATE public.projects
      SET visibility = 'private'
      WHERE id = ${candidate.deniedProjectId}
    `;

    const [baseline] = await transaction<{
      deniedNodes: number;
      deniedMembers: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM public.project_nodes WHERE project_id = ${candidate.deniedProjectId}) AS "deniedNodes",
        (SELECT count(*)::int FROM public.project_members WHERE project_id = ${candidate.deniedProjectId}) AS "deniedMembers"
    `;

    await transaction.unsafe("SET LOCAL ROLE authenticated");
    await transaction`
      SELECT
        set_config('request.jwt.claim.sub', ${candidate.userId}, true),
        set_config('request.jwt.claim.role', 'authenticated', true)
    `;

    const [visible] = await transaction<{
      deniedNodes: number;
      deniedIndex: number;
      deniedEvents: number;
      deniedMembers: number;
      deniedStorage: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM public.project_nodes WHERE project_id = ${candidate.deniedProjectId}) AS "deniedNodes",
        (SELECT count(*)::int FROM public.project_file_index WHERE project_id = ${candidate.deniedProjectId}) AS "deniedIndex",
        (SELECT count(*)::int FROM public.project_node_events WHERE project_id = ${candidate.deniedProjectId}) AS "deniedEvents",
        (SELECT count(*)::int FROM public.project_members WHERE project_id = ${candidate.deniedProjectId}) AS "deniedMembers",
        (
          SELECT count(*)::int
          FROM storage.objects
          WHERE bucket_id = 'project-files'
            AND split_part(name, '/', 2) = ${candidate.deniedProjectId}
        ) AS "deniedStorage"
    `;

    await transaction.unsafe("RESET ROLE");
    await transaction`
      UPDATE public.projects
      SET visibility = ${candidate.deniedProjectVisibility}
      WHERE id = ${candidate.deniedProjectId}
    `;

    return { baseline, visible };
  });

  assert((result.baseline?.deniedNodes ?? 0) > 0, "Denied project needs at least one node");
  assert((result.baseline?.deniedMembers ?? 0) > 0, "Denied project needs at least one member");
  assert.deepEqual(result.visible, {
    deniedNodes: 0,
    deniedIndex: 0,
    deniedEvents: 0,
    deniedMembers: 0,
    deniedStorage: 0,
  });

    console.log("[ponytail-database-hardening] cross-project access denied");
  } finally {
    await sql.end();
  }
}

main(databaseUrl).catch((error) => {
  console.error("[ponytail-database-hardening] failed:", error);
  process.exit(1);
});
