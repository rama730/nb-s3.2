
import fs from 'fs/promises';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateSlug } from '@/lib/utils/slug';

export interface ScannedFile {
    relativePath: string;
    absolutePath: string;
    size: number;
    mimeType: string;
}

const IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    '.DS_Store',
    'coverage',
    '.vercel'
]);

const MIME_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.css': 'text/css',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.py': 'text/x-python',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.sql': 'application/sql',
};

function getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Recursively scans a directory for files, handling ignores.
 */
export async function scanFiles(dir: string, rootDir: string = dir): Promise<ScannedFile[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: ScannedFile[] = [];

    for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath);

        if (entry.isDirectory()) {
            const subFiles = await scanFiles(fullPath, rootDir);
            files.push(...subFiles);
        } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            // Skip large files (> 25MB) for now to be safe
            if (stats.size > 25 * 1024 * 1024) continue;

            files.push({
                relativePath, // e.g., "src/components/Button.tsx"
                absolutePath: fullPath,
                size: stats.size,
                mimeType: getMimeType(entry.name),
            });
        }
    }
    return files;
}

/**
 * Creates the folder structure in the database for the given files.
 * Returns a map of "folderPath" -> "nodeId".
 */
export async function createDirectoryStructure(
    projectId: string,
    files: ScannedFile[],
    userId: string
): Promise<Map<string, string>> {
    // 1. Identify all unique directory paths
    const dirPaths = new Set<string>();
    for (const file of files) {
        const dir = path.dirname(file.relativePath);
        if (dir === '.') continue;

        // Add all intermediate paths
        const parts = dir.split(path.sep);
        let current = '';
        for (const part of parts) {
            current = current ? path.join(current, part) : part;
            dirPaths.add(current);
        }
    }

    // 2. Sort by depth (shortest first) so we create parents before children
    const sortedDirs = Array.from(dirPaths).sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
    const pathMap = new Map<string, string>(); // relativePath -> nodeId

    // 3. Create folders one by one (could be optimized, but safe)
    for (const dirPath of sortedDirs) {
        const parts = dirPath.split(path.sep);
        const name = parts[parts.length - 1];
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : undefined;
        const parentId = parentPath ? pathMap.get(parentPath) : null;

        // Check if exists? (Re-import case)
        // Or just create. Assuming fresh import for now or handled by Unique constraint?
        // Let's try to find existing first to avoid dupes on re-import
        const [existing] = await db.select({ id: projectNodes.id })
            .from(projectNodes)
            .where(and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.parentId, parentId as any), // exact match for parentId (null or uuid)
                eq(projectNodes.name, name),
                eq(projectNodes.type, 'folder')
            ))
            .limit(1);

        if (existing) {
            pathMap.set(dirPath, existing.id);
        } else {
            const [newNode] = await db.insert(projectNodes).values({
                projectId,
                parentId: parentId as string | null, // Cast because we know we resolved it
                name,
                type: 'folder',
                createdBy: userId,
            }).returning();
            pathMap.set(dirPath, newNode.id);
        }
    }

    return pathMap;
}

/**
 * Uploads files to S3 and creates DB records.
 */
export async function uploadToStorageAndDB(
    projectId: string,
    files: ScannedFile[],
    folderMap: Map<string, string>,
    userId: string
) {
    const adminClient = await createAdminClient();

    // Process in batches
    const BATCH_SIZE = 5;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (file) => {
            try {
                const dir = path.dirname(file.relativePath);
                const parentId = dir === '.' ? null : folderMap.get(dir) || null;
                const name = path.basename(file.relativePath);
                const s3Key = `${projectId}/${file.relativePath}`; // Ensure unique key per project

                // 1. Upload Content
                const content = await fs.readFile(file.absolutePath);
                const { error: uploadError } = await adminClient.storage
                    .from('project-files')
                    .upload(s3Key, content, {
                        contentType: file.mimeType,
                        upsert: true
                    });

                if (uploadError) {
                    console.error(`[Worker] Failed to upload ${file.relativePath}`, uploadError);
                    return;
                }

                // 2. Create/Update DB Node
                // Find existing to update or insert new
                const [existing] = await db.select({ id: projectNodes.id })
                    .from(projectNodes)
                    .where(and(
                        eq(projectNodes.projectId, projectId),
                        eq(projectNodes.parentId, parentId as any),
                        eq(projectNodes.name, name),
                        eq(projectNodes.type, 'file')
                    ))
                    .limit(1);

                if (existing) {
                    await db.update(projectNodes)
                        .set({
                            s3Key,
                            size: file.size,
                            mimeType: file.mimeType,
                            updatedAt: new Date()
                        })
                        .where(eq(projectNodes.id, existing.id));
                } else {
                    await db.insert(projectNodes).values({
                        projectId,
                        parentId: parentId as string | null,
                        name,
                        type: 'file',
                        s3Key,
                        size: file.size,
                        mimeType: file.mimeType,
                        createdBy: userId
                    });
                }

            } catch (err) {
                console.error(`[Worker] Error processing file ${file.relativePath}`, err);
            }
        }));
    }
}
