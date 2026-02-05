
import { Worker, Job } from 'bullmq';
import { QUEUES, ImportJobData } from '../lib/queue/config';
import { createRedisConnection } from '../lib/redis/connection';
import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { db } from '../lib/db';
import { projects } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

const git = simpleGit();

/**
 * Process a single import job
 */
async function processImportJob(job: Job<ImportJobData>) {
    const { projectId, importSource, userId, accessToken } = job.data;
    const { repoUrl, branch } = importSource;

    console.log(`[Worker] Starting import for project ${projectId} from ${repoUrl}`);

    // Construct Authenticated URL if token is present
    let cloneUrl = repoUrl;
    if (accessToken && repoUrl.startsWith('https://github.com/')) {
        const repoPath = repoUrl.replace('https://github.com/', '');
        cloneUrl = `https://${accessToken}@github.com/${repoPath}`;
        // Mask token in logs
        console.log(`[Worker] Using authenticated clone for ${repoPath}`);
    }

    // Update DB status to 'cloning'
    await db.update(projects)
        .set({ syncStatus: 'cloning' })
        .where(eq(projects.id, projectId));

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-import-'));
    console.log(`[Worker] Cloning to ${tempDir}`);

    try {
        // 1. Clone
        await git.clone(cloneUrl, tempDir, [
            '--depth', '1',
            ...(branch ? ['--branch', branch] : [])
        ]);

        console.log(`[Worker] Clone successful`);

        // Update DB status to 'indexing'
        await db.update(projects)
            .set({ syncStatus: 'indexing' })
            .where(eq(projects.id, projectId));

        // 2. Scan and Upload
        const { scanFiles, createDirectoryStructure, uploadToStorageAndDB } = await import('./import-utils');

        console.log(`[Worker] Scanning files in ${tempDir}`);
        const files = await scanFiles(tempDir);
        console.log(`[Worker] Found ${files.length} files. Creating structure...`);

        const folderMap = await createDirectoryStructure(projectId, files, userId);

        console.log(`[Worker] Uploading files...`);
        await uploadToStorageAndDB(projectId, files, folderMap, userId);

        // Simulate indexing time (removed, replaced by actual work)


        // 3. Complete
        await db.update(projects)
            .set({ syncStatus: 'ready' })
            .where(eq(projects.id, projectId));

        console.log(`[Worker] Import complete for ${projectId}`);

    } catch (error) {
        console.error(`[Worker] Failed import for ${projectId}`, error);

        await db.update(projects)
            .set({ syncStatus: 'failed' })
            .where(eq(projects.id, projectId));

        throw error;
    } finally {
        // Cleanup
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('[Worker] Cleanup failed', e);
        }
    }
}

/**
 * Initialize the Worker
 */
export const startWorker = () => {
    console.log('[Worker] Starting Project Import Worker...');

    const worker = new Worker<ImportJobData>(QUEUES.PROJECT_IMPORTS, processImportJob, {
        connection: createRedisConnection(),
        concurrency: 2, // Process 2 imports at a time
    });

    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} completed!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
    });

    return worker;
};
