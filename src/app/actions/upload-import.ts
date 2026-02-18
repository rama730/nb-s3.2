'use server';

import { db } from '@/lib/db';
import { projects, projectNodes } from '@/lib/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export type UploadManifestEntry = {
  relativePath: string;
  size?: number | null;
  mimeType?: string | null;
};

function normalizeRelativePath(p: string) {
  return (p || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .trim();
}

function splitDirParts(dir: string) {
  return dir.split('/').map(s => s.trim()).filter(Boolean);
}

const BATCH_SIZE = 500;
const ROOT_KEY = 'root';

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function makeKey(parentId: string | null, name: string) {
  return `${parentId ?? ROOT_KEY}::${name}`;
}

async function fetchExistingNodes(
  tx: any,
  projectId: string,
  type: 'folder' | 'file',
  entries: Array<{ parentId: string | null; name: string }>
) {
  const map = new Map<string, { id: string; parentId: string | null; name: string }>();
  if (entries.length === 0) return map;

  for (const batch of chunkArray(entries, BATCH_SIZE)) {
    const parentIds = Array.from(new Set(batch.map(b => b.parentId)));
    const names = Array.from(new Set(batch.map(b => b.name))).filter(Boolean);
    if (names.length === 0) continue;

    const hasRoot = parentIds.includes(null);
    const nonNullParents = parentIds.filter(p => p !== null) as string[];

    const conditions: any[] = [
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.type, type),
      isNull(projectNodes.deletedAt),
      inArray(projectNodes.name, names),
    ];

    if (hasRoot && nonNullParents.length > 0) {
      conditions.push(sql`(${inArray(projectNodes.parentId, nonNullParents)} OR ${isNull(projectNodes.parentId)})`);
    } else if (hasRoot) {
      conditions.push(isNull(projectNodes.parentId));
    } else if (nonNullParents.length > 0) {
      conditions.push(inArray(projectNodes.parentId, nonNullParents));
    } else {
      continue;
    }

    const rows = await tx
      .select({ id: projectNodes.id, parentId: projectNodes.parentId, name: projectNodes.name })
      .from(projectNodes)
      .where(and(...conditions));

    for (const r of rows) {
      map.set(makeKey(r.parentId ?? null, r.name), { id: r.id, parentId: r.parentId ?? null, name: r.name });
    }
  }

  return map;
}

export async function registerUploadedFolderAction(projectId: string, manifest: UploadManifestEntry[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Project not found');
  if (project.ownerId !== user.id) throw new Error('Unauthorized');

  const entries = (manifest || [])
    .map((e) => ({
      relativePath: normalizeRelativePath(e.relativePath),
      size: e.size ?? 0,
      mimeType: e.mimeType ?? 'application/octet-stream',
    }))
    .filter((e) => e.relativePath.length > 0);

  if (entries.length === 0) {
    // Nothing to register; still mark ready so UI unblocks.
    await db.update(projects)
      .set({ syncStatus: 'ready', updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    revalidatePath(`/projects/${projectId}`);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    revalidatePath('/hub');
    return { success: true, registeredFiles: 0 };
  }

  const result = await db.transaction(async (tx) => {
    await tx.update(projects)
      .set({ syncStatus: 'indexing', updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    // --- Build folder paths ---
    const dirPaths = new Set<string>();
    for (const f of entries) {
      const parts = f.relativePath.split('/');
      if (parts.length <= 1) continue; // file at root
      const dirParts = parts.slice(0, -1);
      let cur = '';
      for (const part of dirParts) {
        cur = cur ? `${cur}/${part}` : part;
        dirPaths.add(cur);
      }
    }

    const sortedDirs = Array.from(dirPaths).sort(
      (a, b) => a.split('/').length - b.split('/').length
    );

    const folderIdByPath = new Map<string, string>();

    // --- Ensure folders exist (batched per depth) ---
    const dirsByDepth = new Map<number, string[]>();
    for (const dirPath of sortedDirs) {
      const depth = dirPath.split('/').length;
      const list = dirsByDepth.get(depth) || [];
      list.push(dirPath);
      dirsByDepth.set(depth, list);
    }

    const depths = Array.from(dirsByDepth.keys()).sort((a, b) => a - b);

    for (const depth of depths) {
      const paths = dirsByDepth.get(depth) || [];
      if (paths.length === 0) continue;

      const items = paths.map((dirPath) => {
        const parts = splitDirParts(dirPath);
        const name = parts[parts.length - 1]!;
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        const parentId = parentPath ? folderIdByPath.get(parentPath) ?? null : null;
        return { dirPath, parentId, name };
      });

      const existingMap = await fetchExistingNodes(
        tx,
        projectId,
        'folder',
        items.map((i) => ({ parentId: i.parentId, name: i.name }))
      );

      const toInsert: Array<{
        projectId: string;
        parentId: string | null;
        type: 'folder';
        name: string;
        createdBy: string;
        createdAt: Date;
        updatedAt: Date;
      }> = [];
      const pathByKey = new Map<string, string>();

      for (const item of items) {
        const key = makeKey(item.parentId, item.name);
        const existing = existingMap.get(key);
        if (existing) {
          folderIdByPath.set(item.dirPath, existing.id);
        } else {
          pathByKey.set(key, item.dirPath);
          const now = new Date();
          toInsert.push({
            projectId,
            parentId: item.parentId,
            type: 'folder',
            name: item.name,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (toInsert.length > 0) {
        const inserted = await tx.insert(projectNodes).values(toInsert).returning({
          id: projectNodes.id,
          parentId: projectNodes.parentId,
          name: projectNodes.name,
        });

        for (const row of inserted) {
          const key = makeKey(row.parentId ?? null, row.name);
          const path = pathByKey.get(key);
          if (path) folderIdByPath.set(path, row.id);
        }
      }
    }

    // --- Upsert files (batched) ---
    let registeredFiles = 0;
    for (const batch of chunkArray(entries, BATCH_SIZE)) {
      const items = batch.map((f) => {
        const parts = f.relativePath.split('/');
        const name = parts[parts.length - 1]!;
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        const parentId = dir ? folderIdByPath.get(dir) ?? null : null;
        const s3Key = `${projectId}/${f.relativePath}`;
        return {
          name,
          parentId,
          s3Key,
          size: f.size ?? 0,
          mimeType: f.mimeType ?? 'application/octet-stream',
        };
      });

      const existingMap = await fetchExistingNodes(
        tx,
        projectId,
        'file',
        items.map((i) => ({ parentId: i.parentId, name: i.name }))
      );

      const toInsert: Array<{
        projectId: string;
        parentId: string | null;
        type: 'file';
        name: string;
        s3Key: string;
        size: number;
        mimeType: string;
        createdBy: string;
        createdAt: Date;
        updatedAt: Date;
      }> = [];
      const toUpdate: Array<{ id: string; s3Key: string; size: number; mimeType: string; updatedAt: Date }> = [];

      for (const item of items) {
        const key = makeKey(item.parentId, item.name);
        const existing = existingMap.get(key);
        if (existing) {
          toUpdate.push({
            id: existing.id,
            s3Key: item.s3Key,
            size: item.size,
            mimeType: item.mimeType,
            updatedAt: new Date(),
          });
        } else {
          const now = new Date();
          toInsert.push({
            projectId,
            parentId: item.parentId,
            type: 'file',
            name: item.name,
            s3Key: item.s3Key,
            size: item.size,
            mimeType: item.mimeType,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (toInsert.length > 0) {
        await tx.insert(projectNodes).values(toInsert);
      }

      if (toUpdate.length > 0) {
        const values = toUpdate.map((u) =>
          sql`(${u.id}, ${u.s3Key}, ${u.size}, ${u.mimeType}, ${u.updatedAt})`
        );
        await tx.execute(sql`
          UPDATE ${projectNodes} AS t
          SET s3_key = v.s3_key,
              size = v.size,
              mime_type = v.mime_type,
              updated_at = v.updated_at
          FROM (VALUES ${sql.join(values, sql`,`)}) AS v(id, s3_key, size, mime_type, updated_at)
          WHERE t.id = v.id
        `);
      }

      registeredFiles += items.length;
    }

    await tx.update(projects)
      .set({ syncStatus: 'ready', updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return { registeredFiles };
  });

  // Refresh the project page (slug or id)
  revalidatePath(`/projects/${projectId}`);
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
  revalidatePath('/hub');

  return { success: true, registeredFiles: result.registeredFiles };
}

export async function markProjectSyncFailedAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Project not found');
  if (project.ownerId !== user.id) throw new Error('Unauthorized');

  await db.update(projects)
    .set({ syncStatus: 'failed', updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
  revalidatePath('/hub');

  return { success: true };
}
