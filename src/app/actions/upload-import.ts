'use server';

import { db } from '@/lib/db';
import { projects, projectNodes } from '@/lib/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { buildProjectImportEventId, buildUploadManifestHash } from '@/lib/import/idempotency';
import { isFilesHardeningEnabled } from '@/lib/features/files';
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
  PROJECT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';

export type UploadManifestEntry = {
  relativePath: string;
  size?: number | null;
  mimeType?: string | null;
};

export type UploadReconcilePolicy = 'mirror' | 'additive';

export type UploadRegisterOptions = {
  sessionId?: string | null;
  manifestHash?: string | null;
  reconcilePolicy?: UploadReconcilePolicy;
};

type UploadSessionState = {
  sessionId: string;
  manifestHash: string;
  totalFiles: number;
  uploadedFiles: number;
  startedAt: string;
  lastActivityAt: string;
  status: 'pending' | 'uploading' | 'registering' | 'reconciling' | 'ready' | 'failed';
};

function normalizeManifestEntry(entry: UploadManifestEntry) {
  const relativePath = normalizeAndValidateUploadRelativePath(entry.relativePath);
  const size = normalizeAndValidateFileSize(entry.size ?? 0, PROJECT_UPLOAD_MAX_FILE_BYTES);
  const mimeType = normalizeAndValidateMimeType(entry.mimeType ?? 'application/octet-stream');
  return { relativePath, size, mimeType };
}

function splitDirParts(dir: string) {
  return dir.split('/').map(s => s.trim()).filter(Boolean);
}

const BATCH_SIZE = 500;
const ROOT_KEY = 'root';
const LOCK_NAMESPACE = 'project-git-sync';

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

function normalizeSessionId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return randomUUID();
  return raw.length > 120 ? raw.slice(0, 120) : raw;
}

function getProjectImportSource(importSource: unknown): Record<string, unknown> {
  if (importSource && typeof importSource === 'object') {
    return importSource as Record<string, unknown>;
  }
  return { type: 'upload' };
}

function getImportMetadata(importSource: Record<string, unknown>): Record<string, unknown> {
  const metadata = importSource.metadata;
  if (metadata && typeof metadata === 'object') {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function buildUploadImportSource(
  currentImportSource: unknown,
  metadataUpdates: Record<string, unknown>,
): Record<string, unknown> {
  const source = getProjectImportSource(currentImportSource);
  const metadata = getImportMetadata(source);
  return {
    ...source,
    type: 'upload',
    metadata: {
      ...metadata,
      ...metadataUpdates,
    },
  };
}

async function withProjectSyncLock<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<{ skipped: boolean; value: T | null }> {
  const lockResult = await db.execute<{ locked: boolean }>(sql`
    SELECT pg_try_advisory_lock(
      hashtext(${LOCK_NAMESPACE}),
      hashtext(CAST(${projectId} AS text))
    ) AS locked
  `);
  const lockRow = Array.from(lockResult)[0];
  const lockAcquired = !!lockRow?.locked;
  if (!lockAcquired) {
    return { skipped: true, value: null };
  }

  try {
    return { skipped: false, value: await task() };
  } finally {
    await db.execute(sql`
      SELECT pg_advisory_unlock(
        hashtext(${LOCK_NAMESPACE}),
        hashtext(CAST(${projectId} AS text))
      )
    `);
  }
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

export async function updateUploadSessionAction(
  projectId: string,
  input: {
    sessionId: string;
    manifestHash: string;
    totalFiles: number;
    uploadedFiles: number;
    status: UploadSessionState['status'];
    importEventId?: string | null;
  },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, importSource: projects.importSource })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Project not found');
  if (project.ownerId !== user.id) throw new Error('Unauthorized');

  const nowIso = new Date().toISOString();
  const sessionId = normalizeSessionId(input.sessionId);
  const manifestHash = (input.manifestHash || '').trim() || 'empty';
  const totalFiles = Math.max(0, Math.floor(Number(input.totalFiles || 0)));
  const uploadedFiles = Math.max(0, Math.floor(Number(input.uploadedFiles || 0)));
  const importEventId =
    (typeof input.importEventId === 'string' && input.importEventId.trim().length > 0)
      ? input.importEventId.trim()
      : buildProjectImportEventId({
        projectId,
        source: 'upload',
        normalizedTarget: 'upload',
        branchOrManifestHash: manifestHash,
      });

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const prevSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const existingSessionId = typeof prevSession?.sessionId === 'string'
    ? prevSession.sessionId
    : null;
  const existingLastActivityAt = typeof prevSession?.lastActivityAt === 'string'
    ? prevSession.lastActivityAt
    : null;
  const existingLastActivityMs = existingLastActivityAt ? Date.parse(existingLastActivityAt) : NaN;
  const incomingLastActivityMs = Date.parse(nowIso);

  if (
    existingSessionId &&
    existingSessionId !== sessionId &&
    Number.isFinite(existingLastActivityMs) &&
    Number.isFinite(incomingLastActivityMs) &&
    existingLastActivityMs > incomingLastActivityMs
  ) {
    const existingManifestHash = typeof prevSession?.manifestHash === 'string' && prevSession.manifestHash.trim().length > 0
      ? prevSession.manifestHash
      : manifestHash;
    const existingImportEventId =
      typeof currentMetadata.importEventId === 'string' && currentMetadata.importEventId.trim().length > 0
        ? currentMetadata.importEventId
        : importEventId;

    return {
      success: true as const,
      sessionId: existingSessionId,
      manifestHash: existingManifestHash,
      importEventId: existingImportEventId,
    };
  }

  const startedAt = typeof prevSession?.startedAt === 'string' ? prevSession.startedAt : nowIso;
  const nextSource = buildUploadImportSource(currentImportSource, {
    syncPhase: input.status,
    importEventId,
    uploadSession: {
      sessionId,
      manifestHash,
      totalFiles,
      uploadedFiles,
      startedAt,
      lastActivityAt: nowIso,
      status: input.status,
    } satisfies UploadSessionState,
  });

  await db.update(projects)
    .set({
      importSource: nextSource as any,
      syncStatus: input.status === 'failed'
        ? 'failed'
        : input.status === 'ready'
          ? 'ready'
          : input.status === 'pending' || input.status === 'uploading'
            ? 'pending'
            : 'indexing',
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return {
    success: true as const,
    sessionId,
    manifestHash,
    importEventId,
  };
}

export async function registerUploadedFolderAction(
  projectId: string,
  manifest: UploadManifestEntry[],
  options?: UploadRegisterOptions,
) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const filesHardeningEnabled = isFilesHardeningEnabled(user.id);

  const [project] = await db
    .select({
      id: projects.id,
      ownerId: projects.ownerId,
      slug: projects.slug,
      importSource: projects.importSource,
      syncStatus: projects.syncStatus,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Project not found');
  if (project.ownerId !== user.id) throw new Error('Unauthorized');

  const entries = (manifest || []).map((entry) => normalizeManifestEntry(entry));

  const manifestHash = (options?.manifestHash || '').trim() || buildUploadManifestHash(entries);
  const sessionId = normalizeSessionId(options?.sessionId);
  const reconcilePolicy: UploadReconcilePolicy =
    options?.reconcilePolicy === 'additive'
      ? 'additive'
      : filesHardeningEnabled
        ? 'mirror'
        : 'additive';
  const importEventId = buildProjectImportEventId({
    projectId,
    source: 'upload',
    normalizedTarget: 'upload',
    branchOrManifestHash: manifestHash,
  });

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const currentSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const currentSessionId = typeof currentSession?.sessionId === 'string' ? currentSession.sessionId : null;
  const currentManifestHash = typeof currentSession?.manifestHash === 'string' ? currentSession.manifestHash : null;
  const currentSessionStatus = typeof currentSession?.status === 'string' ? currentSession.status : null;
  const currentSyncPhase = typeof currentMetadata.syncPhase === 'string' ? currentMetadata.syncPhase : null;

  if (
    currentSessionId === sessionId &&
    currentManifestHash === manifestHash &&
    currentSessionStatus === 'ready' &&
    currentSyncPhase === 'ready' &&
    project.syncStatus === 'ready'
  ) {
    const dedupedRegisteredFiles = Math.max(
      0,
      Number((currentSession?.uploadedFiles as number | undefined) ?? entries.length),
    );
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      deduped: 1,
      registeredFiles: dedupedRegisteredFiles,
      durationMs: Date.now() - startedAt,
    });
    return { success: true as const, deduped: true as const, registeredFiles: dedupedRegisteredFiles, deletedFiles: 0 };
  }

  if (entries.length === 0) {
    const deletedCount = await db.transaction(async (tx) => {
      const now = new Date();
      const nowIso = now.toISOString();
      let deletedFiles = 0;

      if (reconcilePolicy === 'mirror') {
        const activeFiles = await tx
          .select({ id: projectNodes.id })
          .from(projectNodes)
          .where(
            and(
              eq(projectNodes.projectId, projectId),
              eq(projectNodes.type, 'file'),
              isNull(projectNodes.deletedAt),
            ),
          );

        const activeFileIds = activeFiles.map((row) => row.id);
        for (const batchIds of chunkArray(activeFileIds, BATCH_SIZE)) {
          if (batchIds.length === 0) continue;
          await tx
            .update(projectNodes)
            .set({
              deletedAt: now,
              deletedBy: user.id,
              updatedAt: now,
            })
            .where(inArray(projectNodes.id, batchIds));
          deletedFiles += batchIds.length;
        }
      }

      const nextImportSource = buildUploadImportSource(currentImportSource, {
        syncPhase: 'ready',
        importEventId,
        lastError: null,
        uploadSession: {
          sessionId,
          manifestHash,
          totalFiles: 0,
          uploadedFiles: 0,
          startedAt: nowIso,
          lastActivityAt: nowIso,
          status: 'ready',
        } satisfies UploadSessionState,
        reconcile: {
          status: 'completed',
          policy: reconcilePolicy,
          reason: 'empty-manifest',
          deletedFiles,
          completedAt: nowIso,
        },
      });

      await tx.update(projects)
        .set({ syncStatus: 'ready', importSource: nextImportSource as any, updatedAt: now })
        .where(eq(projects.id, projectId));

      return deletedFiles;
    });

    revalidatePath(`/projects/${projectId}`);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    revalidatePath('/hub');
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      deduped: 0,
      registeredFiles: 0,
      deletedFiles: deletedCount,
      durationMs: Date.now() - startedAt,
    });
    return { success: true as const, registeredFiles: 0, deletedFiles: deletedCount };
  }

  try {
    const lockResult = await withProjectSyncLock(projectId, async () => {
      return await db.transaction(async (tx) => {
        const nowIso = new Date().toISOString();
        const keepS3Keys = new Set(entries.map((entry) => buildProjectFileKey(projectId, entry.relativePath)));
        const startedSessionAt = typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso;
        let activeImportSource = buildUploadImportSource(currentImportSource, {
          syncPhase: 'registering',
          importEventId,
          lastError: null,
          uploadSession: {
            sessionId,
            manifestHash,
            totalFiles: entries.length,
            uploadedFiles: entries.length,
            startedAt: startedSessionAt,
            lastActivityAt: nowIso,
            status: 'registering',
          } satisfies UploadSessionState,
          reconcile: {
            status: 'pending',
            policy: reconcilePolicy,
            candidateCount: 0,
            deletedFiles: 0,
          },
        });

        await tx.update(projects)
          .set({
            syncStatus: 'indexing',
            importSource: activeImportSource as any,
            updatedAt: new Date(),
          })
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
            const s3Key = buildProjectFileKey(projectId, f.relativePath);
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

        let deletedFiles = 0;
        let reconcileCandidateCount = 0;
        let reconcileValidatedCount = 0;
        if (reconcilePolicy === 'mirror') {
          activeImportSource = buildUploadImportSource(activeImportSource, {
            syncPhase: 'reconciling',
            uploadSession: {
              sessionId,
              manifestHash,
              totalFiles: entries.length,
              uploadedFiles: registeredFiles,
              startedAt: startedSessionAt,
              lastActivityAt: new Date().toISOString(),
              status: 'reconciling',
            } satisfies UploadSessionState,
            reconcile: {
              status: 'marked',
              policy: reconcilePolicy,
            },
          });
          await tx.update(projects)
            .set({
              syncStatus: 'indexing',
              importSource: activeImportSource as any,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));

          const activeFileNodes = await tx
            .select({ id: projectNodes.id, s3Key: projectNodes.s3Key })
            .from(projectNodes)
            .where(
              and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, 'file'),
                isNull(projectNodes.deletedAt),
              ),
            );

          const candidates = activeFileNodes.filter((node) => {
            if (!node.s3Key) return false;
            return !keepS3Keys.has(node.s3Key);
          });

          const candidateIds = candidates.map((node) => node.id);
          reconcileCandidateCount = candidateIds.length;
          activeImportSource = buildUploadImportSource(activeImportSource, {
            reconcile: {
              status: 'marked',
              policy: reconcilePolicy,
              candidateCount: candidateIds.length,
              deletedFiles: 0,
            },
          });
          await tx.update(projects)
            .set({
              syncStatus: 'indexing',
              importSource: activeImportSource as any,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));

          let validatedCandidateIds = candidateIds;
          if (candidateIds.length > 0) {
            const stillValidRows = await tx
              .select({ id: projectNodes.id, s3Key: projectNodes.s3Key })
              .from(projectNodes)
              .where(
                and(
                  inArray(projectNodes.id, candidateIds),
                  eq(projectNodes.projectId, projectId),
                  eq(projectNodes.type, 'file'),
                  isNull(projectNodes.deletedAt),
                ),
              );

            validatedCandidateIds = stillValidRows
              .filter((node) => !!node.s3Key && !keepS3Keys.has(node.s3Key))
              .map((node) => node.id);
          }
          reconcileValidatedCount = validatedCandidateIds.length;

          activeImportSource = buildUploadImportSource(activeImportSource, {
            reconcile: {
              status: 'validated',
              policy: reconcilePolicy,
              candidateCount: candidateIds.length,
              validatedCount: validatedCandidateIds.length,
              deletedFiles: 0,
            },
          });
          await tx.update(projects)
            .set({
              syncStatus: 'indexing',
              importSource: activeImportSource as any,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));

          for (const batchIds of chunkArray(validatedCandidateIds, BATCH_SIZE)) {
            if (batchIds.length === 0) continue;
            await tx
              .update(projectNodes)
              .set({
                deletedAt: new Date(),
                deletedBy: user.id,
                updatedAt: new Date(),
              })
              .where(inArray(projectNodes.id, batchIds));
            deletedFiles += batchIds.length;
          }
        }

        const completedAt = new Date().toISOString();
        activeImportSource = buildUploadImportSource(activeImportSource, {
          syncPhase: 'ready',
          importEventId,
          lastError: null,
          uploadSession: {
            sessionId,
            manifestHash,
            totalFiles: entries.length,
            uploadedFiles: entries.length,
            startedAt: startedSessionAt,
            lastActivityAt: completedAt,
            status: 'ready',
          } satisfies UploadSessionState,
          reconcile: {
            status: 'committed',
            policy: reconcilePolicy,
            candidateCount: reconcileCandidateCount,
            validatedCount: reconcileValidatedCount,
            deletedFiles,
            completedAt,
          },
        });

        await tx.update(projects)
          .set({
            syncStatus: 'ready',
            importSource: activeImportSource as any,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId));

        return {
          registeredFiles,
          deletedFiles,
          importEventId,
          manifestHash,
          sessionId,
          reconcilePolicy,
        };
      });
    });

    if (lockResult.skipped) {
      let lockOwnerSessionId: string | null = currentSessionId;
      let lockOwnerManifestHash: string | null = currentManifestHash;
      try {
        const [latestProject] = await db
          .select({ importSource: projects.importSource })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        const latestImportSource = getProjectImportSource(latestProject?.importSource);
        const latestMetadata = getImportMetadata(latestImportSource);
        const latestSession = (latestMetadata.uploadSession && typeof latestMetadata.uploadSession === 'object')
          ? latestMetadata.uploadSession as Record<string, unknown>
          : null;
        lockOwnerSessionId = typeof latestSession?.sessionId === 'string' ? latestSession.sessionId : lockOwnerSessionId;
        lockOwnerManifestHash = typeof latestSession?.manifestHash === 'string' ? latestSession.manifestHash : lockOwnerManifestHash;
      } catch {
        // Best-effort lock owner context only; skip branch still returns deterministic collision payload.
      }

      logger.metric('upload.register.result', {
        projectId,
        userId: user.id,
        sessionId,
        manifestHash,
        reconcilePolicy,
        deduped: 1,
        skipped: 'in_progress',
        lockOwnerSessionId,
        lockOwnerManifestHash,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: false as const,
        deduped: true as const,
        skipped: true as const,
        registeredFiles: 0,
        deletedFiles: 0,
        lockOwnerSessionId,
        lockOwnerManifestHash,
      };
    }

    // Refresh the project page (slug or id)
    revalidatePath(`/projects/${projectId}`);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    revalidatePath('/hub');

    const value = lockResult.value || {
      registeredFiles: 0,
      deletedFiles: 0,
      importEventId,
      manifestHash,
      sessionId,
      reconcilePolicy,
    };
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId: value.sessionId,
      manifestHash: value.manifestHash,
      importEventId: value.importEventId,
      reconcilePolicy: value.reconcilePolicy,
      deduped: 0,
      registeredFiles: value.registeredFiles,
      deletedFiles: value.deletedFiles,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true as const,
      deduped: false as const,
      registeredFiles: value.registeredFiles,
      deletedFiles: value.deletedFiles,
      importEventId: value.importEventId,
      manifestHash: value.manifestHash,
      sessionId: value.sessionId,
      reconcilePolicy: value.reconcilePolicy,
    };
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Upload registration failed';
    const nowIso = new Date().toISOString();
    const failedSource = buildUploadImportSource(currentImportSource, {
      syncPhase: 'failed',
      importEventId,
      lastError: message,
      uploadSession: {
        sessionId,
        manifestHash,
        totalFiles: entries.length,
        uploadedFiles: Math.max(0, Math.min(entries.length, Number(currentSession?.uploadedFiles || 0))),
        startedAt: typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso,
        lastActivityAt: nowIso,
        status: 'failed',
      } satisfies UploadSessionState,
    });

    await db.update(projects)
      .set({
        syncStatus: 'failed',
        importSource: failedSource as any,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      result: 'failed',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function markProjectSyncFailedAction(
  projectId: string,
  options?: {
    sessionId?: string | null;
    manifestHash?: string | null;
    reason?: string | null;
  },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, slug: projects.slug, importSource: projects.importSource })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Project not found');
  if (project.ownerId !== user.id) throw new Error('Unauthorized');

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const currentSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const nowIso = new Date().toISOString();
  const sessionId = normalizeSessionId(options?.sessionId || currentSession?.sessionId);
  const manifestHash =
    (typeof options?.manifestHash === 'string' && options.manifestHash.trim().length > 0)
      ? options.manifestHash.trim()
      : (typeof currentSession?.manifestHash === 'string' && currentSession.manifestHash.trim().length > 0)
        ? currentSession.manifestHash
        : 'unknown';
  const reason = (typeof options?.reason === 'string' && options.reason.trim().length > 0)
    ? options.reason.trim()
    : 'Upload import failed';
  const failedSource = buildUploadImportSource(currentImportSource, {
    syncPhase: 'failed',
    lastError: reason,
    importEventId: currentMetadata.importEventId ?? null,
    uploadSession: {
      sessionId,
      manifestHash,
      totalFiles: Math.max(0, Number(currentSession?.totalFiles || 0)),
      uploadedFiles: Math.max(0, Number(currentSession?.uploadedFiles || 0)),
      startedAt: typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso,
      lastActivityAt: nowIso,
      status: 'failed',
    } satisfies UploadSessionState,
  });

  await db.update(projects)
    .set({ syncStatus: 'failed', importSource: failedSource as any, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
  revalidatePath('/hub');

  logger.metric('upload.register.result', {
    projectId,
    userId: user.id,
    sessionId,
    manifestHash,
    result: 'failed',
    reason,
  });

  return { success: true };
}
