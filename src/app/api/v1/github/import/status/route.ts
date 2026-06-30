import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles } from '@/lib/db/schema';
import { and, eq, ne, gt, or, asc } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { assertProjectReadAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const statusQuerySchema = z.object({
    jobId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().max(2048).optional(),
});

const statusCursorSchema = z.object({
    path: z.string(),
    id: z.string().uuid(),
});

function decodeStatusCursor(value: string | undefined) {
    if (!value) return null;
    try {
        return statusCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    } catch {
        return null;
    }
}

function encodeStatusCursor(value: { path: string; id: string }) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * GET /api/v1/github/import/status?jobId=...
 * Returns status info for an import job and any files that are pending or failed.
 */
export async function GET(request: NextRequest) {
    try {
        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:status', 300, 60);
        if (limitResponse) return limitResponse;

        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
        }

        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get('jobId');
        const rawCursor = searchParams.get('cursor')?.trim() || undefined;

        const parsed = statusQuerySchema.safeParse({
            jobId,
            limit: searchParams.get('limit') ?? undefined,
            cursor: rawCursor,
        });
        if (!parsed.success) {
            return jsonError('Invalid or missing jobId parameter', 400, 'BAD_REQUEST');
        }

        const cursor = decodeStatusCursor(parsed.data.cursor);
        if (parsed.data.cursor && !cursor) {
            return jsonError('Invalid cursor', 400, 'BAD_REQUEST');
        }

        const job = await db.query.importJobs.findFirst({
            where: eq(importJobs.id, parsed.data.jobId),
        });

        if (!job) {
            return jsonError('Import job not found', 404, 'NOT_FOUND');
        }

        await assertProjectReadAccess(job.projectId, user.id);

        const rows = await db.query.importJobFiles.findMany({
            where: and(
                eq(importJobFiles.jobId, job.id),
                ne(importJobFiles.status, 'completed'),
                cursor
                    ? or(
                        gt(importJobFiles.path, cursor.path),
                        and(eq(importJobFiles.path, cursor.path), gt(importJobFiles.id, cursor.id)),
                    )
                    : undefined,
            ),
            columns: {
                id: true,
                path: true,
                size: true,
                checksum: true,
                status: true,
                errorMessage: true,
            },
            orderBy: [asc(importJobFiles.path), asc(importJobFiles.id)],
            limit: parsed.data.limit + 1,
        });
        const hasMore = rows.length > parsed.data.limit;
        const files = hasMore ? rows.slice(0, parsed.data.limit) : rows;
        const lastFile = files.at(-1);
        const nextCursor = hasMore && lastFile
            ? encodeStatusCursor({ path: lastFile.path, id: lastFile.id })
            : null;

        return jsonSuccess({
            jobId: job.id,
            projectId: job.projectId,
            status: job.status,
            totalFiles: job.totalFiles,
            processedFiles: job.processedFiles,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            incompleteFiles: files.map(({ id: _id, ...file }) => file),
            nextCursor,
            hasMore,
        });
    } catch (error) {
        logger.error('[github-import-status] failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}
