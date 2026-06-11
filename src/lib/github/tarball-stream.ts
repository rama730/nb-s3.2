import tar from 'tar-stream';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { shouldIgnorePath, isTooLarge } from '@/lib/import/import-filters';

export interface TarballFile {
    path: string; // The path within the repo
    content: Buffer;
}

/**
 * Downloads a tarball from GitHub and yields files sequentially as it streams.
 * Prevents loading the entire repo into memory at once.
 */
export async function* fetchAndParseTarball(
    repoUrl: string, 
    branch: string, 
    token?: string
): AsyncGenerator<TarballFile, void, unknown> {
    const urlParts = repoUrl.replace(/\/$/, '').split('/');
    const repoName = urlParts.pop();
    const ownerName = urlParts.pop();
    const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/tarball/${branch}`;

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'nb-s3-importer',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok || !res.body) {
        throw new Error(`Failed to fetch tarball: ${res.statusText}`);
    }

    const extract = tar.extract();
    const gunzip = zlib.createGunzip();

    let iteratorResolvers: { resolve: (val: any) => void; reject: (err: any) => void }[] = [];
    let fileQueue: TarballFile[] = [];
    let isDone = false;
    let streamError: Error | null = null;

    extract.on('entry', (header, stream, next) => {
        // GitHub tarballs contain a root directory (e.g. owner-repo-sha/). We want to strip it.
        const parts = header.name.split('/');
        parts.shift(); // remove root folder
        const normalizedPath = parts.join('/');

        if (header.type !== 'file' || !normalizedPath || shouldIgnorePath(normalizedPath) || isTooLarge(header.size)) {
            stream.resume();
            return next();
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
            fileQueue.push({ path: normalizedPath, content: Buffer.concat(chunks) });
            if (iteratorResolvers.length > 0) {
                iteratorResolvers.shift()!.resolve({ value: fileQueue.shift(), done: false });
            }
            next();
        });
        stream.on('error', (err) => {
            streamError = err;
            if (iteratorResolvers.length > 0) iteratorResolvers.shift()!.reject(err);
        });
    });

    extract.on('finish', () => {
        isDone = true;
        if (iteratorResolvers.length > 0) {
            for (const r of iteratorResolvers) r.resolve({ done: true });
            iteratorResolvers = [];
        }
    });

    extract.on('error', (err) => {
        streamError = err;
        if (iteratorResolvers.length > 0) iteratorResolvers.forEach(r => r.reject(err));
    });

    // Run pipeline in background
    pipeline(Readable.fromWeb(res.body as any), gunzip, extract).catch(err => {
        streamError = err;
        if (iteratorResolvers.length > 0) iteratorResolvers.forEach(r => r.reject(err));
    });

    while (!isDone || fileQueue.length > 0) {
        if (streamError) throw streamError;
        if (fileQueue.length > 0) {
            yield fileQueue.shift()!;
        } else {
            const result = await new Promise<any>((resolve, reject) => {
                iteratorResolvers.push({ resolve, reject });
            });
            if (result.done) break;
            if (result.value) yield result.value;
        }
    }
}
