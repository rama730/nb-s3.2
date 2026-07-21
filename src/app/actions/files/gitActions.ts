'use server';

import { db } from '@/lib/db';
import { projectGitDeltas, projectNodeConflicts, projectNodes, fileVersions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { randomUUID, createHash } from 'crypto';
import {
    acquireFileLease,
    assertOwnedFileLease,
    releaseFileLease,
} from '@/lib/files/file-lock-service';

function computeSha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

export async function getPendingDeltasAction(projectId: string, targetBranch: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const deltas = await db.query.projectGitDeltas.findMany({
            where: and(
                eq(projectGitDeltas.projectId, projectId),
                eq(projectGitDeltas.targetBranch, targetBranch),
                eq(projectGitDeltas.status, 'pending')
            ),
            orderBy: [projectGitDeltas.sequenceNumber, projectGitDeltas.deltaOrder],
        });

        return { success: true, deltas };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function getProjectConflictsAction(projectId: string, targetBranch: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const conflicts = await db.query.projectNodeConflicts.findMany({
            where: and(
                eq(projectNodeConflicts.projectId, projectId),
                eq(projectNodeConflicts.gitBranch, targetBranch),
                eq(projectNodeConflicts.conflictStatus, 'unresolved')
            ),
        });

        // Resolve paths and names
        const conflictsWithNodes = await Promise.all(
            conflicts.map(async (c) => {
                const node = await db.query.projectNodes.findFirst({
                    where: eq(projectNodes.id, c.nodeId),
                    columns: { name: true, path: true },
                });
                return {
                    ...c,
                    fileName: node?.name || 'unknown',
                    filePath: node?.path || 'unknown',
                };
            })
        );

        return { success: true, conflicts: conflictsWithNodes };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function resolveConflictAction(
    conflictId: string,
    resolution: 'keep_mine' | 'keep_remote' | 'merge',
    mergedContent?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const conflict = await db.query.projectNodeConflicts.findFirst({
            where: eq(projectNodeConflicts.id, conflictId),
        });
        if (!conflict) throw new Error('Conflict not found');

        const node = await db.query.projectNodes.findFirst({
            where: eq(projectNodes.id, conflict.nodeId),
        });
        if (!node) throw new Error('Node not found');

        let finalContent = '';
        if (resolution === 'keep_mine') {
            // Content is already current local node in DB/S3
            finalContent = ''; // No change needed
        } else if (resolution === 'keep_remote') {
            finalContent = conflict.canonicalContent || '';
        } else if (resolution === 'merge') {
            finalContent = mergedContent || '';
        }

        const lease = await acquireFileLease({
            projectId: conflict.projectId,
            nodeId: node.id,
            userId: user.id,
            sessionId: randomUUID(),
            clientKind: 'web',
            ttlSeconds: 60,
        });

        try {
        await db.transaction(async (tx) => {
            await tx
                .select({ id: projectNodes.id })
                .from(projectNodes)
                .where(eq(projectNodes.id, node.id))
                .for('update');
            await assertOwnedFileLease(tx, {
                projectId: conflict.projectId,
                nodeId: node.id,
                userId: user.id,
                credentials: lease,
            });
            if (resolution !== 'keep_mine') {
                const adminClient = await createAdminClient();
                const storageKey = buildProjectFileKey(conflict.projectId, `conflicts/${conflict.id}-${Date.now()}`);
                
                // Upload content to S3
                const { error: uploadError } = await adminClient.storage
                    .from('project-files')
                    .upload(storageKey, Buffer.from(finalContent, 'utf8'), {
                        contentType: node.mimeType || 'text/plain',
                    });

                if (uploadError) {
                    throw new Error(`Failed to upload resolved content to storage: ${uploadError.message}`);
                }

                const contentHash = computeSha256(finalContent);
                const nextVersion = node.currentVersion + 1;

                // Update node version
                await tx
                    .update(projectNodes)
                    .set({
                        currentVersion: nextVersion,
                        s3Key: storageKey,
                        size: Buffer.from(finalContent, 'utf8').length,
                        gitHash: contentHash,
                        syncStatus: 'merged',
                        updatedAt: new Date(),
                    })
                    .where(eq(projectNodes.id, node.id));

                // Insert new version
                await tx.insert(fileVersions).values({
                    nodeId: node.id,
                    version: nextVersion,
                    s3Key: storageKey,
                    size: Buffer.from(finalContent, 'utf8').length,
                    mimeType: node.mimeType || 'text/plain',
                    contentHash,
                    uploadedBy: user.id,
                    uploadedAt: new Date(),
                });
            }

            // Update conflict status
            await tx
                .update(projectNodeConflicts)
                .set({
                    conflictStatus: 'resolved',
                    mergedContent: resolution === 'keep_mine' ? conflict.incomingContent : (resolution === 'keep_remote' ? conflict.canonicalContent : mergedContent),
                })
                .where(eq(projectNodeConflicts.id, conflictId));

            // Reset deltas from conflict/failed to pending so they can be pushed/pulled again
            await tx
                .update(projectGitDeltas)
                .set({
                    status: 'pending',
                })
                .where(
                    and(
                        eq(projectGitDeltas.projectId, conflict.projectId),
                        eq(projectGitDeltas.targetBranch, conflict.gitBranch),
                        eq(projectGitDeltas.status, 'conflict')
                    )
                );
        });
        } finally {
            await releaseFileLease({
                projectId: conflict.projectId,
                nodeId: node.id,
                userId: user.id,
                credentials: lease,
            }).catch(() => false);
        }

        return { success: true };
    } catch (err: any) {
        console.error('[resolveConflictAction] error:', err);
        return { success: false, error: err.message };
    }
}
