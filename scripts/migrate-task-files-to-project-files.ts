/**
 * Migrate legacy task_files + task-files bucket into the new Files subsystem:
 *   - storage: task-files  -> project-files (copy objects)
 *   - db:      task_files  -> project_nodes + task_node_links
 *
 * Safe to re-run:
 * - Uses project_nodes.metadata.legacy_task_file_id to skip already-migrated rows.
 * - Uses unique index on task_node_links(task_id,node_id) to avoid duplicate links.
 *
 * Requirements (.env.local or env):
 * - DATABASE_URL
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx tsx scripts/migrate-task-files-to-project-files.ts
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";
import { extname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in env (.env.local).");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env (.env.local).");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, ssl: "require" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type LegacyRow = {
  id: string;
  task_id: string;
  file_name: string;
  custom_name: string | null;
  file_path: string;
  file_size: number;
  file_type: string | null;
  description: string | null;
  category: string | null;
  tags: any;
  uploaded_by: string | null;
  created_at: string;
  project_id: string;
  task_title: string;
};

function safeFolderName(taskTitle: string, taskId: string) {
  const t = (taskTitle || "Task").trim().replace(/\s+/g, " ").slice(0, 80);
  return `${t} (${taskId.slice(0, 8)})`;
}

async function ensureBucket(name: string) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = (data || []).some((b) => b.name === name);
  if (exists) return;
  const { error: createError } = await supabase.storage.createBucket(name, {
    public: false,
    fileSizeLimit: 10485760, // 10MB (matches legacy)
  });
  if (createError) throw createError;
}

async function ensureAttachmentsRootFolder(projectId: string, actorId: string | null) {
  const [existing] = await sql<[{ id: string }?]>`
    SELECT id FROM project_nodes
    WHERE project_id = ${projectId}
      AND parent_id IS NULL
      AND type = 'folder'
      AND name = 'Task Attachments'
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (existing?.id) return existing.id;

  const [created] = await sql<[{ id: string }]>`
    INSERT INTO project_nodes (project_id, parent_id, type, name, metadata, created_by, created_at, updated_at)
    VALUES (
      ${projectId},
      NULL,
      'folder',
      'Task Attachments',
      ${JSON.stringify({ isSystem: true, kind: "task_attachments_root" })}::jsonb,
      ${actorId},
      now(),
      now()
    )
    RETURNING id
  `;
  return created.id;
}

async function ensureTaskFolder(projectId: string, rootId: string, folderName: string, actorId: string | null) {
  const [existing] = await sql<[{ id: string }?]>`
    SELECT id FROM project_nodes
    WHERE project_id = ${projectId}
      AND parent_id = ${rootId}
      AND type = 'folder'
      AND name = ${folderName}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (existing?.id) return existing.id;

  const [created] = await sql<[{ id: string }]>`
    INSERT INTO project_nodes (project_id, parent_id, type, name, metadata, created_by, created_at, updated_at)
    VALUES (
      ${projectId},
      ${rootId},
      'folder',
      ${folderName},
      ${JSON.stringify({ isSystem: true, kind: "task_attachments_folder" })}::jsonb,
      ${actorId},
      now(),
      now()
    )
    RETURNING id
  `;
  return created.id;
}

async function alreadyMigrated(projectId: string, legacyId: string) {
  const [row] = await sql<[{ id: string }?]>`
    SELECT id FROM project_nodes
    WHERE project_id = ${projectId}
      AND (metadata->>'legacy_task_file_id') = ${legacyId}
    LIMIT 1
  `;
  return row?.id ?? null;
}

function newStoragePath(projectId: string, legacy: LegacyRow) {
  const ext = extname(legacy.file_name || "") || (legacy.file_type ? `.${legacy.file_type.split("/").pop()}` : "");
  const id = crypto.randomBytes(12).toString("hex");
  return `projects/${projectId}/${id}${ext || ""}`;
}

async function copyObject(fromPath: string, toPath: string, contentType?: string | null) {
  const { data, error } = await supabase.storage.from("task-files").download(fromPath);
  if (error) throw error;
  const blob = data; // Blob
  const { error: uploadError } = await supabase.storage.from("project-files").upload(toPath, blob, {
    upsert: false,
    contentType: contentType || undefined,
  });
  if (uploadError) throw uploadError;
}

async function main() {
  console.log("🚀 Migrating legacy task_files -> project_nodes + task_node_links");
  await ensureBucket("project-files");
  // task-files bucket must exist already for legacy data; if it doesn't, migration is impossible.
  await ensureBucket("task-files");

  const files = await sql<LegacyRow[]>`
    SELECT
      tf.id,
      tf.task_id,
      tf.file_name,
      tf.custom_name,
      tf.file_path,
      tf.file_size,
      tf.file_type,
      tf.description,
      tf.category,
      tf.tags,
      tf.uploaded_by,
      tf.created_at,
      t.project_id,
      COALESCE(t.title, 'Task') AS task_title
    FROM task_files tf
    JOIN tasks t ON t.id = tf.task_id
    WHERE t.project_id IS NOT NULL
  `;

  console.log(`Found ${files.length} legacy rows.`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // Caches
  const projectRootFolderByProjectId = new Map<string, string>();
  const taskFolderByTaskId = new Map<string, string>();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const idx = `${i + 1}/${files.length}`;
    try {
      const existingNodeId = await alreadyMigrated(f.project_id, f.id);
      if (existingNodeId) {
        // Ensure link exists (idempotent)
        await sql`
          INSERT INTO task_node_links (task_id, node_id, linked_at, created_by)
          VALUES (${f.task_id}, ${existingNodeId}, ${f.created_at}, ${f.uploaded_by})
          ON CONFLICT (task_id, node_id) DO NOTHING
        `;
        skipped++;
        if ((i + 1) % 50 === 0) console.log(`… ${idx} (migrated=${migrated}, skipped=${skipped}, failed=${failed})`);
        continue;
      }

      // Ensure folder structure (Task Attachments / <TaskTitle (deadbeef)>)
      if (!projectRootFolderByProjectId.has(f.project_id)) {
        const rootId = await ensureAttachmentsRootFolder(f.project_id, f.uploaded_by);
        projectRootFolderByProjectId.set(f.project_id, rootId);
      }
      const rootId = projectRootFolderByProjectId.get(f.project_id)!;

      if (!taskFolderByTaskId.has(f.task_id)) {
        const folderName = safeFolderName(f.task_title, f.task_id);
        const folderId = await ensureTaskFolder(f.project_id, rootId, folderName, f.uploaded_by);
        taskFolderByTaskId.set(f.task_id, folderId);
      }
      const folderId = taskFolderByTaskId.get(f.task_id)!;

      // Copy storage object to new bucket
      const dstPath = newStoragePath(f.project_id, f);
      await copyObject(f.file_path, dstPath, f.file_type);

      // Insert new project node
      const displayName = f.custom_name || f.file_name;
      const metadata = {
        legacy_task_file_id: f.id,
        legacy_bucket: "task-files",
        legacy_file_path: f.file_path,
        original_name: f.file_name,
        description: f.description,
        category: f.category,
        tags: f.tags ?? [],
      };

      const [createdNode] = await sql<[{ id: string }]>`
        INSERT INTO project_nodes (
          project_id,
          parent_id,
          type,
          name,
          s3_key,
          size,
          mime_type,
          metadata,
          created_by,
          created_at,
          updated_at
        )
        VALUES (
          ${f.project_id},
          ${folderId},
          'file',
          ${displayName},
          ${dstPath},
          ${f.file_size},
          ${f.file_type},
          ${JSON.stringify(metadata)}::jsonb,
          ${f.uploaded_by},
          ${f.created_at},
          now()
        )
        RETURNING id
      `;

      // Link to task
      await sql`
        INSERT INTO task_node_links (task_id, node_id, linked_at, created_by)
        VALUES (${f.task_id}, ${createdNode.id}, ${f.created_at}, ${f.uploaded_by})
        ON CONFLICT (task_id, node_id) DO NOTHING
      `;

      migrated++;
      if ((i + 1) % 20 === 0) console.log(`… ${idx} (migrated=${migrated}, skipped=${skipped}, failed=${failed})`);
    } catch (e: any) {
      failed++;
      console.error(`❌ ${idx} failed (legacyId=${f.id} path=${f.file_path}):`, e?.message || e);
    }
  }

  console.log("\n✅ Migration finished.");
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Failed:   ${failed}`);
}

main()
  .catch((e) => {
    console.error("❌ Migration crashed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });

