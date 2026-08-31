import { sql } from "drizzle-orm";

import { db } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!APPLY) {
    console.log("Legacy normalization backfill is read-only by default.");
    console.log("Run `pnpm tsx scripts/backfill.ts --apply` after a database backup.");
    console.log("Canonical skills use `pnpm tsx scripts/backfill-market-skills.ts --apply`.");
    return;
  }

  const stats = await db.transaction(async (tx) => {
    const insertedTags = await tx.execute<{ id: string }>(sql`
      WITH source AS MATERIALIZED (
        SELECT DISTINCT ON (slug) label, slug
        FROM projects p
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.tags, '[]'::jsonb)) AS value(label)
        CROSS JOIN LATERAL (
          SELECT trim(both '-' from regexp_replace(lower(value.label), '[^a-z0-9]+', '-', 'g')) AS slug
        ) normalized
        WHERE normalized.slug <> ''
        ORDER BY slug, label
      )
      INSERT INTO tags (name, slug)
      SELECT label, slug FROM source
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const linkedTags = await tx.execute<{ id: string }>(sql`
      WITH source AS MATERIALIZED (
        SELECT DISTINCT p.id AS project_id,
          trim(both '-' from regexp_replace(lower(value.label), '[^a-z0-9]+', '-', 'g')) AS slug
        FROM projects p
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.tags, '[]'::jsonb)) AS value(label)
      )
      INSERT INTO project_tags (project_id, tag_id)
      SELECT source.project_id, tags.id
      FROM source
      JOIN tags ON tags.slug = source.slug
      WHERE source.slug <> ''
      ON CONFLICT (project_id, tag_id) DO NOTHING
      RETURNING id
    `);
    const insertedInterests = await tx.execute<{ id: string }>(sql`
      WITH source AS MATERIALIZED (
        SELECT DISTINCT ON (slug) label, slug
        FROM profiles p
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.interests, '[]'::jsonb)) AS value(label)
        CROSS JOIN LATERAL (
          SELECT trim(both '-' from regexp_replace(lower(value.label), '[^a-z0-9]+', '-', 'g')) AS slug
        ) normalized
        WHERE normalized.slug <> ''
        ORDER BY slug, label
      )
      INSERT INTO interests (name, slug)
      SELECT label, slug FROM source
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const linkedInterests = await tx.execute<{ id: string }>(sql`
      WITH source AS MATERIALIZED (
        SELECT DISTINCT p.id AS profile_id,
          trim(both '-' from regexp_replace(lower(value.label), '[^a-z0-9]+', '-', 'g')) AS slug
        FROM profiles p
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.interests, '[]'::jsonb)) AS value(label)
      )
      INSERT INTO profile_interests (profile_id, interest_id)
      SELECT source.profile_id, interests.id
      FROM source
      JOIN interests ON interests.slug = source.slug
      WHERE source.slug <> ''
      ON CONFLICT (profile_id, interest_id) DO NOTHING
      RETURNING id
    `);
    const updatedPaths = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE tree AS (
        SELECT node.id, node.project_id, node.parent_id,
          ('/' || node.name)::text AS canonical_path,
          ARRAY[node.id]::uuid[] AS visited
        FROM project_nodes node
        WHERE node.parent_id IS NULL

        UNION ALL

        SELECT child.id, child.project_id, child.parent_id,
          (parent.canonical_path || '/' || child.name)::text,
          parent.visited || child.id
        FROM project_nodes child
        JOIN tree parent
          ON parent.id = child.parent_id
         AND parent.project_id = child.project_id
        WHERE NOT child.id = ANY(parent.visited)
      )
      UPDATE project_nodes node
      SET path = tree.canonical_path
      FROM tree
      WHERE node.id = tree.id
        AND node.path IS DISTINCT FROM tree.canonical_path
      RETURNING node.id
    `);

    const [integrity] = await tx.execute<{ cyclic: number; unreachable: number }>(sql`
      WITH RECURSIVE ancestry AS (
        SELECT node.id AS origin_id, node.parent_id,
          ARRAY[node.id]::uuid[] AS visited, false AS cyclic
        FROM project_nodes node
        UNION ALL
        SELECT ancestry.origin_id, parent.parent_id,
          ancestry.visited || parent.id,
          parent.id = ANY(ancestry.visited)
        FROM ancestry
        JOIN project_nodes parent ON parent.id = ancestry.parent_id
        WHERE NOT ancestry.cyclic
      ), rooted AS (
        WITH RECURSIVE tree AS (
          SELECT id, project_id FROM project_nodes WHERE parent_id IS NULL
          UNION ALL
          SELECT child.id, child.project_id
          FROM project_nodes child
          JOIN tree parent
            ON parent.id = child.parent_id
           AND parent.project_id = child.project_id
        )
        SELECT id FROM tree
      )
      SELECT
        count(DISTINCT origin_id) FILTER (WHERE cyclic)::int AS cyclic,
        (SELECT count(*)::int FROM project_nodes node WHERE NOT EXISTS (
          SELECT 1 FROM rooted WHERE rooted.id = node.id
        )) AS unreachable
      FROM ancestry
    `);
    if ((integrity?.cyclic ?? 0) > 0 || (integrity?.unreachable ?? 0) > 0) {
      throw new Error(
        `Path backfill refused: cyclic=${integrity?.cyclic ?? 0}, unreachable=${integrity?.unreachable ?? 0}`,
      );
    }

    return {
      tags: Array.from(insertedTags).length,
      projectTags: Array.from(linkedTags).length,
      interests: Array.from(insertedInterests).length,
      profileInterests: Array.from(linkedInterests).length,
      paths: Array.from(updatedPaths).length,
    };
  });

  console.log("Legacy normalization backfill complete.", stats);
}

main().catch((error) => {
  console.error("Legacy normalization backfill failed.", error);
  process.exitCode = 1;
});
