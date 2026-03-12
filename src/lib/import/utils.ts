
import fs from 'fs/promises';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projectNodes } from '@/lib/db/schema';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { IGNORED_DIRS, isTooLarge } from '@/lib/import/import-filters';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { appendSafePathSegment } from '@/lib/security/path-safety';

export interface ScannedFile {
    relativePath: string;
    absolutePath: string;
    size: number;
    mimeType: string;
}

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

const ROOT_KEY = 'root';
const FILE_BATCH_SIZE = 50;
const DB_BATCH_SIZE = 500;
const UPLOAD_CONCURRENCY = 5;
const MAX_IMPORT_FILE_COUNT = Number(process.env.GITHUB_IMPORT_MAX_FILES || 6000);
const MAX_IMPORT_TOTAL_BYTES = Number(process.env.GITHUB_IMPORT_MAX_TOTAL_BYTES || 1024 * 1024 * 1024); // 1GB
const MAX_IMPORT_DIR_COUNT = Number(process.env.GITHUB_IMPORT_MAX_DIRS || 8000);

function normalizeRelativePath(p: string): string {
    return (p || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

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
    projectId: string,
    type: 'folder' | 'file',
    entries: Array<{ parentId: string | null; name: string }>
) {
    const map = new Map<string, { id: string; parentId: string | null; name: string }>();
    if (entries.length === 0) return map;

    for (const batch of chunkArray(entries, DB_BATCH_SIZE)) {
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

        const rows = await db.query.projectNodes.findMany({
            where: and(...conditions),
            columns: { id: true, parentId: true, name: true },
        });

        for (const r of rows) {
            map.set(makeKey(r.parentId ?? null, r.name), {
                id: r.id,
                parentId: r.parentId ?? null,
                name: r.name,
            });
        }
    }

    return map;
}

async function collectDirPaths(dir: string, rootDir: string, dirPaths: Set<string>) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = appendSafePathSegment(dir, entry.name, 'directory entry');
        const rel = normalizeRelativePath(path.relative(rootDir, fullPath));

        if (entry.isDirectory()) {
            if (rel && rel !== '.') {
                dirPaths.add(rel);
            }
            await collectDirPaths(fullPath, rootDir, dirPaths);
        }
    }
}

async function* walkFiles(dir: string, rootDir: string): AsyncGenerator<ScannedFile> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = appendSafePathSegment(dir, entry.name, 'directory entry');
        const relativePath = normalizeRelativePath(path.relative(rootDir, fullPath));

        if (entry.isDirectory()) {
            yield* walkFiles(fullPath, rootDir);
        } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            if (isTooLarge(stats.size)) continue;
            yield {
                relativePath,
                absolutePath: fullPath,
                size: stats.size,
                mimeType: getMimeType(entry.name),
            };
        }
    }
}
/**
 * Recursively scans a directory for files, handling ignores.
 */
export async function scanFiles(dir: string, rootDir: string = dir): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    for await (const f of walkFiles(dir, rootDir)) {
        files.push(f);
    }
    return files;
}

async function createDirectoryStructureFromPaths(
    projectId: string,
    dirPaths: Set<string>,
    userId: string
): Promise<Map<string, string>> {
    const sortedDirs = Array.from(dirPaths).sort(
        (a, b) => a.split('/').length - b.split('/').length
    );

    const folderIdByPath = new Map<string, string>();
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
            const parts = dirPath.split('/');
            const name = parts[parts.length - 1]!;
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            const parentId = parentPath ? folderIdByPath.get(parentPath) ?? null : null;
            return { dirPath, parentId, name };
        });

        const existingMap = await fetchExistingNodes(
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
                    createdBy: userId,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }

        if (toInsert.length > 0) {
            const inserted = await db.insert(projectNodes).values(toInsert).returning({
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

    return folderIdByPath;
}

// ...

/**
 * Creates the folder structure in the database for the given files.
 * Returns a map of "folderPath" -> "nodeId".
 */
export async function createDirectoryStructure(
    projectId: string,
    files: ScannedFile[],
    userId: string
): Promise<Map<string, string>> {
    const dirPaths = new Set<string>();
    for (const file of files) {
        const dir = path.posix.dirname(normalizeRelativePath(file.relativePath));
        if (!dir || dir === '.') continue;

        const parts = dir.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            dirPaths.add(current);
        }
    }

    return await createDirectoryStructureFromPaths(projectId, dirPaths, userId);
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

    const runWithConcurrency = async <T, R>(
        items: T[],
        limit: number,
        worker: (item: T) => Promise<R>
    ): Promise<R[]> => {
        const results: R[] = new Array(items.length);
        let index = 0;
        const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
            while (index < items.length) {
                const current = index++;
                results[current] = await worker(items[current]);
            }
        });
        await Promise.all(runners);
        return results;
    };

    const upsertFileNodesBatch = async (batch: ScannedFile[]) => {
        const items = batch.map((file) => {
            const rel = normalizeRelativePath(file.relativePath);
            const dir = path.posix.dirname(rel);
            const parentId = dir === '.' ? null : folderMap.get(dir) || null;
            const name = path.posix.basename(rel);
            const s3Key = buildProjectFileKey(projectId, rel);
            return { name, parentId, s3Key, size: file.size, mimeType: file.mimeType };
        });

        const existingMap = await fetchExistingNodes(
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
                    createdBy: userId,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }

        if (toInsert.length > 0) {
            await db.insert(projectNodes).values(toInsert);
        }

        if (toUpdate.length > 0) {
            const values = toUpdate.map((u) =>
                sql`(${u.id}, ${u.s3Key}, ${u.size}, ${u.mimeType}, ${u.updatedAt})`
            );
            await db.execute(sql`
                UPDATE ${projectNodes} AS t
                SET s3_key = v.s3_key,
                    size = v.size,
                    mime_type = v.mime_type,
                    updated_at = v.updated_at
                FROM (VALUES ${sql.join(values, sql`,`)}) AS v(id, s3_key, size, mime_type, updated_at)
                WHERE t.id = v.id
            `);
        }
    };

    for (let i = 0; i < files.length; i += FILE_BATCH_SIZE) {
        const batch = files.slice(i, i + FILE_BATCH_SIZE);
        console.log("[Worker] Uploading batch", {
            start: i,
            end: Math.min(i + FILE_BATCH_SIZE, files.length),
            total: files.length,
        });

        const results = await runWithConcurrency(batch, UPLOAD_CONCURRENCY, async (file) => {
            try {
                const rel = normalizeRelativePath(file.relativePath);
                const s3Key = buildProjectFileKey(projectId, rel);
                const content = await fs.readFile(file.absolutePath);
                const { error: uploadError } = await adminClient.storage
                    .from('project-files')
                    .upload(s3Key, content, {
                        contentType: file.mimeType,
                        upsert: true
                    });

                if (uploadError) {
                    console.error("[Worker] Failed to upload file", {
                        relativePath: file.relativePath,
                        uploadError,
                    });
                    return null;
                }
                return file;
            } catch (err) {
                console.error("[Worker] Error processing file", {
                    relativePath: file.relativePath,
                    error: err,
                });
                return null;
            }
        });

        const successful = results.filter((f): f is ScannedFile => !!f);
        if (successful.length > 0) {
            await upsertFileNodesBatch(successful);
        }
    }
}

export async function createDirectoryStructureFromRoot(
    projectId: string,
    rootDir: string,
    userId: string
): Promise<Map<string, string>> {
    const dirPaths = new Set<string>();
    await collectDirPaths(rootDir, rootDir, dirPaths);
    if (dirPaths.size > MAX_IMPORT_DIR_COUNT) {
        throw new Error(`Repository has too many folders (${dirPaths.size}). Limit is ${MAX_IMPORT_DIR_COUNT}.`);
    }
    return await createDirectoryStructureFromPaths(projectId, dirPaths, userId);
}

export async function uploadRepoFiles(
    projectId: string,
    rootDir: string,
    folderMap: Map<string, string>,
    userId: string
): Promise<{ processed: number; uploaded: number; failed: number; touchedNodeIds: string[] }> {
    const adminClient = await createAdminClient();
    const touchedNodeIds = new Set<string>();

    const runWithConcurrency = async <T, R>(
        items: T[],
        limit: number,
        worker: (item: T) => Promise<R>
    ): Promise<R[]> => {
        const results: R[] = new Array(items.length);
        let index = 0;
        const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
            while (index < items.length) {
                const current = index++;
                results[current] = await worker(items[current]);
            }
        });
        await Promise.all(runners);
        return results;
    };

    const upsertFileNodesBatch = async (batch: ScannedFile[]) => {
        const items = batch.map((file) => {
            const rel = normalizeRelativePath(file.relativePath);
            const dir = path.posix.dirname(rel);
            const parentId = dir === '.' ? null : folderMap.get(dir) || null;
            const name = path.posix.basename(rel);
            const s3Key = buildProjectFileKey(projectId, rel);
            return { name, parentId, s3Key, size: file.size, mimeType: file.mimeType };
        });

        const existingMap = await fetchExistingNodes(
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
                    createdBy: userId,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }

        if (toInsert.length > 0) {
            const inserted = await db.insert(projectNodes).values(toInsert).returning({
                id: projectNodes.id,
            });
            for (const row of inserted) {
                touchedNodeIds.add(row.id);
            }
        }

        if (toUpdate.length > 0) {
            for (const row of toUpdate) {
                touchedNodeIds.add(row.id);
            }
            const values = toUpdate.map((u) =>
                sql`(${u.id}, ${u.s3Key}, ${u.size}, ${u.mimeType}, ${u.updatedAt})`
            );
            await db.execute(sql`
                UPDATE ${projectNodes} AS t
                SET s3_key = v.s3_key,
                    size = v.size,
                    mime_type = v.mime_type,
                    updated_at = v.updated_at
                FROM (VALUES ${sql.join(values, sql`,`)}) AS v(id, s3_key, size, mime_type, updated_at)
                WHERE t.id = v.id
            `);
        }
    };

    let batch: ScannedFile[] = [];
    let fileCount = 0;
    let totalBytes = 0;
    let uploadedCount = 0;
    let failedCount = 0;
    for await (const file of walkFiles(rootDir, rootDir)) {
        batch.push(file);
        fileCount++;
        totalBytes += file.size;

        if (fileCount > MAX_IMPORT_FILE_COUNT) {
            throw new Error(`Repository has too many files (${fileCount}). Limit is ${MAX_IMPORT_FILE_COUNT}.`);
        }
        if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
            throw new Error(`Repository is too large (${totalBytes} bytes). Limit is ${MAX_IMPORT_TOTAL_BYTES} bytes.`);
        }

        if (batch.length >= FILE_BATCH_SIZE) {
            const results = await runWithConcurrency(batch, UPLOAD_CONCURRENCY, async (f) => {
                try {
                    const rel = normalizeRelativePath(f.relativePath);
                    const s3Key = buildProjectFileKey(projectId, rel);
                    const content = await fs.readFile(f.absolutePath);
                    const { error: uploadError } = await adminClient.storage
                        .from('project-files')
                        .upload(s3Key, content, {
                            contentType: f.mimeType,
                            upsert: true
                        });
                    if (uploadError) {
                        console.error("[Worker] Failed to upload file", {
                            relativePath: f.relativePath,
                            uploadError,
                        });
                        return null;
                    }
                    return f;
                } catch (err) {
                    console.error("[Worker] Error processing file", {
                        relativePath: f.relativePath,
                        error: err,
                    });
                    return null;
                }
            });
            const successful = results.filter((f): f is ScannedFile => !!f);
            uploadedCount += successful.length;
            failedCount += results.length - successful.length;
            if (successful.length > 0) {
                await upsertFileNodesBatch(successful);
            }
            batch = [];
        }
    }

    if (batch.length > 0) {
        const results = await runWithConcurrency(batch, UPLOAD_CONCURRENCY, async (f) => {
            try {
                const rel = normalizeRelativePath(f.relativePath);
                const s3Key = buildProjectFileKey(projectId, rel);
                const content = await fs.readFile(f.absolutePath);
                const { error: uploadError } = await adminClient.storage
                    .from('project-files')
                    .upload(s3Key, content, {
                        contentType: f.mimeType,
                        upsert: true
                    });
                if (uploadError) {
                    console.error("[Worker] Failed to upload file", {
                        relativePath: f.relativePath,
                        uploadError,
                    });
                    return null;
                }
                return f;
            } catch (err) {
                console.error("[Worker] Error processing file", {
                    relativePath: f.relativePath,
                    error: err,
                });
                return null;
            }
        });
        const successful = results.filter((f): f is ScannedFile => !!f);
        uploadedCount += successful.length;
        failedCount += results.length - successful.length;
        if (successful.length > 0) {
            await upsertFileNodesBatch(successful);
        }
    }

    return {
        processed: fileCount,
        uploaded: uploadedCount,
        failed: failedCount,
        touchedNodeIds: Array.from(touchedNodeIds),
    };
}
