import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { captureNodePageQuery } from "../helpers/files-node-page-query";
import { taskFileAssociationsSql, taskFileRoleSql, taskFileEntriesSql } from "../../src/lib/files/task-file-collection-query";
import { inferTaskFileRole, type TaskLinkedNode } from "../../src/lib/projects/task-file-intelligence";

test("production pagination predicates keep project, Trash and task visibility filters on every sort/page", { skip: process.env.FILES_COLLECTION_READONLY_AUDIT !== "1" }, async () => {
  const connection = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const dialect = new PgDialect();
  const project = "11111111-1111-4111-8111-111111111111";
  try {
    await connection.begin("read only", async tx => {
      for (const sort of ["name", "updated", "type"] as const) for (const rank of [0, 1]) for (const search of [undefined, "file"]) {
        const cursor = Buffer.from(JSON.stringify({ v: 2, sort, rank, id: "00000000-0000-4000-8000-000000000000", name: "A:::file", mime: "", date: "2026-01-01T00:00:00.000Z" })).toString("base64url");
        const page = await captureNodePageQuery(project, sort, cursor, search);
        const q = dialect.sqlToQuery(sql`
          WITH project_nodes AS (
            SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid AS id,
              CASE WHEN i = 2 THEN '22222222-2222-4222-8222-222222222222'::uuid ELSE ${project}::uuid END AS project_id,
              CASE WHEN i = 3 THEN now() ELSE NULL::timestamptz END AS deleted_at,
              CASE WHEN i = 4 THEN '33333333-3333-4333-8333-333333333333'::uuid ELSE NULL::uuid END AS task_id,
              NULL::uuid AS parent_id, 'file'::text AS type, 'Z file'::text AS name,
              '/file'::text AS path, 'text/plain'::text AS mime_type, '2025-01-01'::timestamptz AS updated_at
            FROM generate_series(1,4) i
          ) SELECT id FROM project_nodes WHERE ${page.where} ORDER BY ${sql.join(page.orderBy, sql`, `)} LIMIT ${page.limit}
        `);
        const rows = await tx.unsafe(q.sql, q.params as never[]);
        assert.deepEqual(rows.map(row => row.id), ["00000000-0000-4000-8000-000000000001"], `${sort}, rank=${rank}, search=${search}: no cursor branch may bypass access filters`);
      }
    });
  } finally { await connection.end(); }
});

test("task collection SQL: role parity, linked files, legacy ownership, project isolation and deletion", { skip: process.env.FILES_COLLECTION_READONLY_AUDIT !== "1" }, async () => {
  const connection = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const dialect = new PgDialect();
  try {
    await connection.begin("read only", async tx => {
      const fixtures: TaskLinkedNode[] = [
        { id: "1", name: "README.md", path: "/", type: "file", tags: ["initial_reference"] },
        { id: "2", name: "final.pdf", path: "/", type: "file", tags: ["working_file"], annotation: "#deliverable" },
        { id: "3", name: "guide.md", path: "/Documents", type: "file" },
        { id: "4", name: "documentary.mp4", path: "/docs", type: "file" },
        { id: "5", name: "draft.py", path: "/", type: "file", annotation: "#DELIVERABLE" },
        { id: "6", name: "file.txt", path: "/", type: "file", canonicalNodeId: "x" },
        { id: "7", name: "stuff.zip", path: "/", type: "file", annotation: "review these requirements" },
        { id: "8", name: "file.md", path: "/", type: "folder", tags: ["deliverable", "initial_reference"] },
      ];
      for (const item of fixtures) {
        const query = dialect.sqlToQuery(sql`SELECT ${taskFileRoleSql({ tags: sql`${JSON.stringify(item.tags ?? [])}::text::jsonb`, annotation: sql`${item.annotation ?? null}::text`, name: sql`${item.name}::text`, canonicalNodeId: sql`${item.canonicalNodeId ?? null}::text` })} AS role`);
        const rows = await tx.unsafe(query.sql, query.params as never[]);
        assert.equal(rows[0]?.role, inferTaskFileRole(item), item.name);
      }
      const project = "11111111-1111-4111-8111-111111111111";
      const query = dialect.sqlToQuery(sql`
        WITH tasks(id, project_id, deleted_at) AS (VALUES
          ('22222222-2222-4222-8222-222222222222'::uuid, ${project}::uuid, NULL::timestamptz),
          ('33333333-3333-4333-8333-333333333333'::uuid, ${project}::uuid, now())
        ), fixture_nodes(id, project_id, task_id, parent_id, path, name, canonical_node_id, deleted_at) AS (VALUES
          ('44444444-4444-4444-8444-444444444444'::uuid, ${project}::uuid, NULL::uuid, NULL::uuid, '/README.md', 'README.md', NULL::uuid, NULL::timestamptz),
          ('55555555-5555-4555-8555-555555555555'::uuid, ${project}::uuid, '22222222-2222-4222-8222-222222222222'::uuid, NULL::uuid, '/.system/tasks/22222222-2222-4222-8222-222222222222/sketch.png', 'sketch.png', NULL::uuid, NULL::timestamptz),
          ('66666666-6666-4666-8666-666666666666'::uuid, ${project}::uuid, NULL::uuid, NULL::uuid, '/removed.txt', 'removed.txt', NULL::uuid, now()),
          ('77777777-7777-4777-8777-777777777777'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, NULL::uuid, NULL::uuid, '/private.txt', 'private.txt', NULL::uuid, NULL::timestamptz),
          ('88888888-8888-4888-8888-888888888888'::uuid, ${project}::uuid, '22222222-2222-4222-8222-222222222222'::uuid, NULL::uuid, '/.system/tasks/22222222-2222-4222-8222-222222222222/detached.png', 'detached.png', NULL::uuid, NULL::timestamptz)
        ), project_nodes AS (SELECT *, CASE WHEN name = 'detached.png' THEN '{"taskFileDetachedFrom":"22222222-2222-4222-8222-222222222222"}'::jsonb ELSE '{}'::jsonb END AS metadata FROM fixture_nodes), task_node_links(task_id, node_id, tags, annotation) AS (VALUES
          ('22222222-2222-4222-8222-222222222222'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '["initial_reference"]'::jsonb, NULL::text),
          ('33333333-3333-4333-8333-333333333333'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '[]'::jsonb, NULL::text),
          ('22222222-2222-4222-8222-222222222222'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, '[]'::jsonb, NULL::text),
          ('22222222-2222-4222-8222-222222222222'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, '[]'::jsonb, NULL::text)
        ) SELECT * FROM (${taskFileAssociationsSql(project)} SELECT * FROM attachments) collection ORDER BY node_id
      `);
      const rows = await tx.unsafe(query.sql, query.params as never[]);
      assert.equal(rows.length, 2, "deleted, foreign-project and explicitly detached files stay excluded");
      assert.deepEqual(rows.map(row => row.role), ["reference", "working"]);

      const task = "22222222-2222-4222-8222-222222222222";
      const fileFixtures = sql`WITH tasks AS (SELECT ${task}::uuid AS id, ${project}::uuid AS project_id, NULL::timestamptz AS deleted_at),
        project_nodes AS (SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid AS id,
          ${project}::uuid AS project_id, NULL::uuid AS task_id, NULL::uuid AS parent_id,
          '/file' || i AS path, 'file' || i AS name, NULL::uuid AS canonical_node_id, NULL::timestamptz AS deleted_at, '{}'::jsonb AS metadata FROM generate_series(1, 70) i),
        task_node_links AS (SELECT ${task}::uuid AS task_id, id AS node_id, '["initial_reference"]'::jsonb AS tags, NULL::text AS annotation FROM project_nodes)`;
      const readPage = async (after?: string, search = "", role?: string) => {
        const q = dialect.sqlToQuery(sql`${fileFixtures} SELECT * FROM (${taskFileEntriesSql(project, [task], false, after, search, role)}) page`);
        return tx.unsafe(q.sql, q.params as never[]);
      };
      const first = await readPage();
      assert.equal(first.length, 51, "prefetch is bounded to 50 files plus a next-page sentinel");
      const next = await readPage(first[49]!.node_id);
      assert.equal(next.length, 20);
      assert.equal(new Set([...first.slice(0, 50), ...next].map(row => row.node_id)).size, 70);
      assert.equal((await readPage(undefined, "file70")).length, 1, "search filters BEFORE pagination");
      assert.equal((await readPage(undefined, "", "working")).length, 0, "role filter matches task panel roles");
    });
  } finally { await connection.end(); }
});
