import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { parseProjectFileKey } from "../../../src/lib/storage/project-file-key";

const project = "11111111-1111-4111-8111-111111111111";
const source = readFileSync("src/lib/files/permanent-delete.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

// Run the real cleanup control flow with an in-memory DB/storage boundary.
// No credential, network request, or project file is touched by these tests.
function fixture(
  options: {
    storageError?: boolean;
    active?: boolean;
    system?: boolean;
    foreignKey?: boolean;
    alias?: boolean;
    missingIntent?: boolean;
    scopeChanged?: boolean;
    missing?: boolean;
    count?: number;
  } = {},
) {
  const events: string[] = [];
  const removed: string[] = [];
  const node = {
    id: "root",
    projectId: project,
    deletedAt: options.active ? null : new Date(),
    s3Key: `${options.foreignKey ? "22222222-2222-4222-8222-222222222222" : project}/current`,
    metadata: {
      isSystem: options.system,
      permanentDeleteRoot: options.missingIntent ? undefined : "root",
    },
  };
  const nodes = options.missing
    ? []
    : [
        node,
        ...(options.scopeChanged
          ? [{ ...node, id: "child", metadata: {} }]
          : []),
      ];
  const table = (name: string) =>
    new Proxy(
      { table: name },
      {
        get: (object, key: string) =>
          key === "table" ? object.table : `${name}.${key}`,
      },
    );
  const schema = {
    projectNodes: table("nodes"),
    fileVersions: table("versions"),
    projects: table("projects"),
    projectMarkdowns: table("docs"),
    taskNodeLinks: table("links"),
  };
  const tx = {
    execute: async () =>
      options.count
        ? Array.from({ length: options.count }, (_, index) => ({
            id: String(index),
          }))
        : nodes.map((n) => ({ id: n.id })),
    query: {
      projectNodes: {
        findMany: async () => nodes,
        findFirst: async (input: unknown) =>
          JSON.stringify(input).includes("canonicalNodeId")
            ? options.alias
              ? { id: "dependent" }
              : undefined
            : nodes[0],
      },
      fileVersions: {
        findMany: async () => [
          { s3Key: `${project}/old` },
          { s3Key: `${project}/shared` },
        ],
      },
    },
    select: () => ({
      from: (target: { table: string }) => ({
        where: () => {
          if (target.table === "projects")
            return {
              for: async () => {
                events.push("lock");
                return [{ id: project }];
              },
            };
          if (target.table === "nodes")
            return Promise.resolve([{ key: `${project}/shared` }]);
          if (target.table === "versions")
            return Promise.resolve([{ key: `${project}/current` }]);
          return Promise.resolve([{ count: 1 }]);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        events.push("delete");
      },
    }),
  };
  const orm = Object.fromEntries(
    ["and", "eq", "inArray", "notInArray"].map((name) => [
      name,
      (...args: unknown[]) => ({ [name]: args }),
    ]),
  );
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { ...orm, sql: (...args: unknown[]) => args },
    "@/lib/db/schema": schema,
    "@/lib/db": {
      db: {
        transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
      },
    },
    "@/lib/storage/project-file-key": { parseProjectFileKey },
    "./internal-helpers": {
      recordNodeEvent: async (_p: unknown, _actor: unknown, id: unknown) => {
        assert.equal(id, null, "audit survives target deletion");
        events.push("audit");
      },
    },
    "@/lib/supabase/server": {
      createAdminClient: async () => ({
        storage: {
          from: (bucket: string) => {
            assert.equal(bucket, "project-files");
            return {
              remove: async (keys: string[]) => {
                removed.push(...keys);
                events.push("storage");
                return {
                  error: options.storageError ? new Error("unavailable") : null,
                };
              },
            };
          },
        },
      }),
    },
  };
  const serviceModule = {
    exports: {} as {
      finishPermanentDelete: (
        project: string,
        id: string,
      ) => Promise<{ deletedIds: string[] }>;
    },
  };
  runInNewContext(compiled, {
    module: serviceModule,
    exports: serviceModule.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return {
    run: () => serviceModule.exports.finishPermanentDelete(project, "root"),
    events,
    removed,
  };
}

test("purge retains blobs referenced by other nodes or versions, including Trash", async () => {
  const f = fixture();
  assert.deepEqual(Array.from((await f.run()).deletedIds), ["root"]);
  assert.deepEqual(f.removed, [`${project}/old`]);
  assert.deepEqual(f.events, ["lock", "storage", "audit", "delete"]);
});

test("storage failure leaves the durable tombstone intact for retry", async () => {
  const f = fixture({ storageError: true });
  await assert.rejects(f.run(), /cleanup is incomplete/);
  assert.deepEqual(f.events, ["lock", "storage"]);
});

test("repeating a completed deletion is an idempotent no-op", async () => {
  const f = fixture({ missing: true });
  assert.equal((await f.run()).deletedIds.length, 0);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.events, ["lock"]);
});

for (const [options, message] of [
  [{ active: true }, /Only items already in Trash/],
  [{ system: true }, /System folders/],
  [{ foreignKey: true }, /storage key/],
  [{ alias: true }, /depends on this original/],
  [{ missingIntent: true }, /not authorized/],
  [{ scopeChanged: true }, /scope changed/],
  [{ count: 501 }, /more than 500/],
] as const)
  test(`purge rejects unsafe scope: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), message);
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.events, ["lock"]);
  });
