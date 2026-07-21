import { db } from "@/lib/db";
import { projects, projectNodes, fileVersions } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { recordNodeEvent } from "@/lib/files/internal-helpers";

/**
 * Merges a sandboxed task branch back into the main project tree.
 * Enforces the strict 11-step transaction detailed in the architectural report.
 */
export async function mergeSandboxTask(
  actorId: string,
  projectId: string,
  taskId: string,
  sessionId: string,
  targetBranch: string = 'main'
) {
  return await db.transaction(async (tx) => {
    // 0. Increment project sequence clock atomically
    const [project] = await tx
      .update(projects)
      .set({
        currentSequenceNumber: sql`${projects.currentSequenceNumber} + 1`
      })
      .where(eq(projects.id, projectId))
      .returning({
        newSequenceNumber: projects.currentSequenceNumber
      });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    const seqNum = project.newSequenceNumber;

    // Step 1: Lock target canonical nodes
    await tx.execute(sql`
      SELECT id FROM project_nodes 
      WHERE id IN (
          SELECT canonical_node_id FROM project_nodes 
          WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND canonical_node_id IS NOT NULL
      ) FOR UPDATE
    `);

    const activeLease = await tx.execute<{ nodeId: string }>(sql`
      SELECT locks.node_id AS "nodeId"
      FROM project_node_locks locks
      WHERE locks.project_id = ${projectId}::uuid
        AND locks.expires_at > now()
        AND locks.node_id IN (
          SELECT canonical_node_id
          FROM project_nodes
          WHERE project_id = ${projectId}::uuid
            AND task_id = ${taskId}::uuid
            AND canonical_node_id IS NOT NULL
        )
      LIMIT 1
    `);
    if (Array.from(activeLease)[0]) {
      throw new Error("Task merge deferred because a collaborator is editing an affected file");
    }

    // Step 2: Lock parent folders and target paths on the main branch
    await tx.execute(sql`
      SELECT id FROM project_nodes
      WHERE project_id = ${projectId}::uuid AND task_id IS NULL AND deleted_at IS NULL
        AND (
          id IN (SELECT parent_id FROM project_nodes WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid)
          OR path IN (SELECT path FROM project_nodes WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid)
        ) FOR UPDATE
    `);

    // Step 3: Preflight Path Collision checking
    const collisionRows = await tx.execute<{ id: string; path: string }>(sql`
      SELECT id, path FROM project_nodes pn
      WHERE pn.project_id = ${projectId}::uuid AND pn.task_id IS NULL AND pn.deleted_at IS NULL 
        AND pn.path IN (
            SELECT path FROM project_nodes 
            WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND sync_status <> 'deleted_tombstone'
              AND (canonical_node_id IS NULL OR path <> (SELECT path FROM project_nodes WHERE id = canonical_node_id))
        )
        AND pn.id NOT IN (
            SELECT COALESCE(canonical_node_id, '00000000-0000-0000-0000-000000000000'::uuid) 
            FROM project_nodes 
            WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid
        )
    `);

    if (Array.from(collisionRows).length > 0) {
      const collisionPaths = Array.from(collisionRows).map(r => r.path).join(', ');
      throw new Error(`ERR_FS_PATH_COLLISION: Collision detected on path(s): ${collisionPaths}`);
    }

    // Step 4: Promote Edits (clone version only if content changed)
    await tx.execute(sql`
      INSERT INTO file_versions (id, node_id, version, s3_key, size, mime_type, content_hash, uploaded_by, comment, uploaded_at)
      SELECT gen_random_uuid(),
             staged.canonical_node_id,
             COALESCE(canonical.current_version, 0) + 1,
             fv.s3_key, fv.size, fv.mime_type, fv.content_hash, fv.uploaded_by, fv.comment, fv.uploaded_at
      FROM project_nodes staged
      JOIN file_versions fv ON fv.node_id = staged.id
      JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id
      WHERE fv.id = (SELECT id FROM file_versions WHERE node_id = staged.id ORDER BY version DESC LIMIT 1)
        AND staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid AND staged.canonical_node_id IS NOT NULL
        AND (staged.s3_key IS DISTINCT FROM canonical.s3_key OR staged.git_blob_hash IS DISTINCT FROM canonical.git_blob_hash)
    `);

    // Step 5: Log Git Deltas
    await tx.execute(sql`
      INSERT INTO project_git_deltas (id, project_id, task_id, target_branch, sequence_number, delta_order, action, node_id, path, old_path, git_blob_hash, file_version_id, s3_key, status, created_at)
      SELECT gen_random_uuid(),
             project_id, task_id, target_branch, sequence_number,
             ROW_NUMBER() OVER (ORDER BY category ASC, path ASC) as delta_order,
             action, node_id, path, old_path, git_blob_hash, file_version_id, s3_key, 'pending', NOW()
      FROM (
          SELECT DISTINCT ON (node_id, action) *
          FROM (
              -- Category 1: Deletes (Direct)
              SELECT staged.project_id, staged.task_id, ${targetBranch} as target_branch, ${seqNum}::bigint as sequence_number, 1 as category,
                     'delete' as action, staged.canonical_node_id as node_id, canonical.path as path, NULL as old_path, NULL as git_blob_hash, NULL::uuid as file_version_id, NULL as s3_key
              FROM project_nodes staged
              JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id
              WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid AND staged.sync_status = 'deleted_tombstone'
              
              UNION ALL
              
              -- Category 1: Deletes (Folder Descendants)
              SELECT pn.project_id, ${taskId}::uuid as task_id, ${targetBranch} as target_branch, ${seqNum}::bigint as sequence_number, 1 as category,
                     'delete' as action, pn.id as node_id, pn.path, NULL as old_path, NULL as git_blob_hash, NULL::uuid as file_version_id, NULL as s3_key
              FROM project_nodes pn
              JOIN project_nodes staged_tombstones ON staged_tombstones.project_id = pn.project_id
                AND staged_tombstones.task_id = ${taskId}::uuid 
                AND staged_tombstones.sync_status = 'deleted_tombstone' 
                AND staged_tombstones.type = 'folder'
              JOIN project_nodes canonical_folders ON canonical_folders.id = staged_tombstones.canonical_node_id
              WHERE pn.project_id = ${projectId}::uuid 
                AND pn.task_id IS NULL 
                AND pn.deleted_at IS NULL
                AND pn.path LIKE canonical_folders.path || '/%'
              
              UNION ALL
              
              -- Category 2: Renames
              SELECT staged.project_id, staged.task_id, ${targetBranch} as target_branch, ${seqNum}::bigint as sequence_number, 2 as category,
                     'rename' as action, staged.canonical_node_id as node_id, staged.path, canonical.path as old_path, staged.git_blob_hash, NULL::uuid as file_version_id, staged.s3_key
              FROM project_nodes staged
              JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id
              WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid AND staged.canonical_node_id IS NOT NULL AND staged.sync_status <> 'deleted_tombstone'
                AND staged.path <> canonical.path
              
              UNION ALL
              
              -- Category 3: Modifies
              SELECT staged.project_id, staged.task_id, ${targetBranch} as target_branch, ${seqNum}::bigint as sequence_number, 3 as category,
                     'modify' as action, staged.canonical_node_id as node_id, staged.path, NULL as old_path, staged.git_blob_hash,
                     (SELECT id FROM file_versions WHERE node_id = staged.id ORDER BY version DESC LIMIT 1) as file_version_id,
                     staged.s3_key
              FROM project_nodes staged
              JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id
              WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid AND staged.canonical_node_id IS NOT NULL AND staged.type = 'file'
                AND staged.sync_status <> 'deleted_tombstone'
                AND (staged.s3_key IS DISTINCT FROM canonical.s3_key OR staged.git_blob_hash IS DISTINCT FROM canonical.git_blob_hash)
              
              UNION ALL
              
              -- Category 4: Adds
              SELECT project_id, task_id, ${targetBranch} as target_branch, ${seqNum}::bigint as sequence_number, 4 as category,
                     'add' as action, id as node_id, path, NULL as old_path, git_blob_hash,
                     (SELECT id FROM file_versions WHERE node_id = project_nodes.id ORDER BY version DESC LIMIT 1) as file_version_id,
                     s3_key
              FROM project_nodes
              WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND canonical_node_id IS NULL AND sync_status <> 'deleted_tombstone'
          ) raw_deltas
          ORDER BY node_id, action, category ASC
      ) deltas
    `);

    // Step 6: Apply Deletions (Soft-delete canonical node and descendants on main)
    await tx.execute(sql`
      UPDATE project_nodes 
      SET deleted_at = NOW(), deleted_by = ${actorId}::uuid
      WHERE id IN (
          SELECT canonical_node_id 
          FROM project_nodes 
          WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND sync_status = 'deleted_tombstone'
      ) OR id IN (
          SELECT pn.id
          FROM project_nodes pn
          JOIN project_nodes staged_tombstones ON staged_tombstones.project_id = pn.project_id
            AND staged_tombstones.task_id = ${taskId}::uuid 
            AND staged_tombstones.sync_status = 'deleted_tombstone' 
            AND staged_tombstones.type = 'folder'
          JOIN project_nodes canonical_folders ON canonical_folders.id = staged_tombstones.canonical_node_id
          WHERE pn.project_id = ${projectId}::uuid 
            AND pn.task_id IS NULL 
            AND pn.deleted_at IS NULL
            AND pn.path LIKE canonical_folders.path || '/%'
      )
    `);

    // Step 7: Update Canonical Node Metadata
    await tx.execute(sql`
      UPDATE project_nodes canonical
      SET parent_id = COALESCE(
            (SELECT canonical_node_id FROM project_nodes WHERE id = staged.parent_id AND project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid),
            staged.parent_id
          ),
          path = staged.path,
          name = staged.name,
          current_version = CASE 
            WHEN staged.type = 'file' AND (staged.s3_key IS DISTINCT FROM canonical.s3_key OR staged.git_blob_hash IS DISTINCT FROM canonical.git_blob_hash) 
            THEN canonical.current_version + 1 
            ELSE canonical.current_version 
          END,
          s3_key = staged.s3_key,
          size = staged.size,
          git_blob_hash = staged.git_blob_hash,
          sync_status = 'merged',
          updated_at = NOW()
      FROM project_nodes staged
      WHERE canonical.id = staged.canonical_node_id
        AND staged.project_id = ${projectId}::uuid 
        AND staged.task_id = ${taskId}::uuid 
        AND staged.canonical_node_id IS NOT NULL
        AND staged.sync_status <> 'deleted_tombstone'
    `);

    // Step 8: Handle Folder Renames child path prefix recalculation
    const renamedFolders = await tx.execute<{ id: string; old_path: string; new_path: string }>(sql`
      SELECT staged.canonical_node_id as id, canonical.path as old_path, staged.path as new_path
      FROM project_nodes staged
      JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id
      WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid
        AND staged.type = 'folder' AND staged.sync_status <> 'deleted_tombstone'
        AND staged.path <> canonical.path
    `);

    for (const folder of Array.from(renamedFolders)) {
      await tx.execute(sql`
        UPDATE project_nodes 
        SET path = ${folder.new_path} || SUBSTRING(path FROM ${folder.old_path.length + 1}),
            updated_at = NOW()
        WHERE project_id = ${projectId}::uuid 
          AND task_id IS NULL
          AND deleted_at IS NULL
          AND path LIKE ${folder.old_path + '/%'}
      `);
    }

    // Step 9: Promote New Files & Folders
    await tx
        .update(projectNodes)
        .set({
            taskId: null,
            syncStatus: 'merged',
            createdBy: actorId,
            updatedAt: new Date()
        })
        .where(
            and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.taskId, taskId),
                isNull(projectNodes.canonicalNodeId)
            )
        );

    // Step 10: Cleanup remaining sandbox nodes. Editor leases are never
    // deleted by a merge; only their exact owner credentials may release them.
    await tx
        .delete(projectNodes)
        .where(
            and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.taskId, taskId)
            )
        );

    // Record overall merge event
    await recordNodeEvent(projectId, actorId, null, 'task_merge', { taskId, sessionId, seqNum }, tx);

    return { success: true, sequenceNumber: seqNum };
  });
}
