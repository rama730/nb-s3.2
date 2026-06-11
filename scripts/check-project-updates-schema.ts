import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as dotenv from "dotenv";

import { PROJECT_UPDATE_SCHEMA_CONTRACT } from "../src/lib/projects/updates";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[project-updates-schema] DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: "require",
  max: 1,
});

async function main() {
  const errors: string[] = [];

  const tableRows = await sql<{ table_name: string; relrowsecurity: boolean }[]>`
    SELECT c.relname AS table_name, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY(${PROJECT_UPDATE_SCHEMA_CONTRACT.tables})
  `;
  const tables = new Map(tableRows.map((row) => [row.table_name, row]));
  for (const table of PROJECT_UPDATE_SCHEMA_CONTRACT.tables) {
    const row = tables.get(table);
    if (!row) {
      errors.push(`missing table public.${table}`);
      continue;
    }
    if (!row.relrowsecurity) errors.push(`RLS disabled on public.${table}`);
  }

  const indexRows = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${PROJECT_UPDATE_SCHEMA_CONTRACT.indexes})
  `;
  const indexes = new Set(indexRows.map((row) => row.indexname));
  for (const index of PROJECT_UPDATE_SCHEMA_CONTRACT.indexes) {
    if (!indexes.has(index)) errors.push(`missing index public.${index}`);
  }

  const policyRows = await sql<{ tablename: string; count: number }[]>`
    SELECT tablename, COUNT(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${PROJECT_UPDATE_SCHEMA_CONTRACT.tables})
    GROUP BY tablename
  `;
  const policies = new Map(policyRows.map((row) => [row.tablename, row.count]));
  for (const [table, minCount] of Object.entries(PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts)) {
    const count = policies.get(table) ?? 0;
    if (count < minCount) errors.push(`public.${table} has ${count} policy/policies, expected at least ${minCount}`);
  }

  const [defaultRow] = await sql<{ default_expr: string | null }[]>`
    SELECT column_default AS default_expr
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'public_tab_visibility'
    LIMIT 1
  `;
  if (!defaultRow?.default_expr?.includes('"updates": true')) {
    errors.push('projects.public_tab_visibility default does not include "updates": true');
  }

  if (errors.length > 0) {
    console.error("[project-updates-schema] failed:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("Run `npm run db:setup` to apply the idempotent repair path.");
    process.exit(1);
  }

  console.log("[project-updates-schema] ok");
}

main()
  .catch((error) => {
    console.error("[project-updates-schema] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });

