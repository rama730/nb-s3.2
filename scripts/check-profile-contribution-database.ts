import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const disposableUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL_FRESH || process.env.DATABASE_URL_REPLAY_FRESH;
if (!disposableUrl) {
  throw new Error(
    "Profile contribution database integration requires E2E_DATABASE_URL, DATABASE_URL_FRESH, or DATABASE_URL_REPLAY_FRESH. The primary database is never used.",
  );
}
if (process.env.DATABASE_URL && disposableUrl === process.env.DATABASE_URL) {
  throw new Error("Refusing to run profile contribution integration checks against DATABASE_URL.");
}

const sql = postgres(disposableUrl, { max: 1, prepare: false });
const ROLLBACK = Symbol("profile-contribution-integration-rollback");

function requireContract(label: string, passed: boolean) {
  if (!passed) throw new Error(`Profile contribution database contract failed: ${label}`);
}

async function main() {
  const [profile] = await sql<{ id: string }[]>`
    SELECT id
    FROM profiles
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;
  requireContract("disposable database has a profile fixture", Boolean(profile?.id));

  const contributionId = randomUUID();
  const externalKey = `integration:${randomUUID()}`;
  try {
    await sql.begin(async (tx) => {
      const transaction = tx as unknown as typeof sql;
      const [created] = await transaction<{ id: string; version: number; visibility: string }[]>`
        INSERT INTO profile_project_contributions (
          id, profile_id, project_id, external_key, project_title, source, role_kind,
          role_title, visibility, version, created_at, updated_at
        ) VALUES (
          ${contributionId}, ${profile!.id}, NULL, ${externalKey}, 'Integration contribution',
          'manual', 'contributor', 'Contributor', 'private', 1, now(), now()
        )
        RETURNING id, version, visibility
      `;
      requireContract("external contribution insert uses normalized identity", created?.id === contributionId);
      requireContract("new contribution starts private and version one", created?.visibility === "private" && created.version === 1);

      const [updated] = await transaction<{ version: number }[]>`
        UPDATE profile_project_contributions
        SET summary = 'Versioned update', version = version + 1, updated_at = now()
        WHERE id = ${contributionId} AND version = 1
        RETURNING version
      `;
      requireContract("optimistic version update advances exactly once", updated?.version === 2);

      const staleUpdate = await transaction<{ id: string }[]>`
        UPDATE profile_project_contributions
        SET summary = 'Stale update', version = version + 1
        WHERE id = ${contributionId} AND version = 1
        RETURNING id
      `;
      requireContract("stale version update changes no rows", staleUpdate.length === 0);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  const constraints = await sql<{ conname: string; definition: string }[]>`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'profile_project_contributions'::regclass
      AND conname IN (
        'profile_project_contributions_authority_shape_check',
        'profile_project_contributions_version_check'
      )
  `;
  const constraintNames = new Set(constraints.map((row) => row.conname));
  requireContract("authority shape constraint is installed", constraintNames.has("profile_project_contributions_authority_shape_check"));
  requireContract("positive version constraint is installed", constraintNames.has("profile_project_contributions_version_check"));

  const indexes = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'profile_project_contributions_profile_project_active_unique',
        'profile_project_contributions_profile_external_active_unique',
        'profile_audit_events_contribution_batch_key_unique'
      )
  `;
  requireContract("all normalized uniqueness indexes are installed", indexes.length === 3);

  const policies = await sql<{ tablename: string; policyname: string; qual: string | null }[]>`
    SELECT tablename, policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profile_project_contributions',
        'profile_project_contribution_stages',
        'profile_contribution_skills'
      )
  `;
  const publicContribution = policies.find((row) => row.policyname === "Public profile contributions are viewable");
  const publicStage = policies.find((row) => row.policyname === "Public profile contribution stages are viewable");
  const visibleSkill = policies.find((row) => row.policyname === "Visible contribution skills are readable");
  requireContract("public contribution RLS uses visibility", Boolean(publicContribution?.qual?.includes("visibility")));
  requireContract("stage RLS derives from the parent contribution", Boolean(publicStage?.qual?.includes("profile_project_contributions")));
  requireContract("skill RLS derives from the parent contribution", Boolean(visibleSkill?.qual?.includes("profile_project_contributions")));

  console.log("[profile-contribution-database] ok");
}

main()
  .catch((error) => {
    console.error("[profile-contribution-database] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
