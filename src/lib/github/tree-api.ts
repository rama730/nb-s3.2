import { shouldIgnorePath, isTooLarge } from '@/lib/import/import-filters';

export interface GithubTreeEntry {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
}

export interface GithubTreeResponse {
    sha: string;
    url: string;
    tree: GithubTreeEntry[];
    truncated: boolean;
}

export interface TreeFileNode {
    path: string;
    name: string;
    type: 'file' | 'folder';
    sha: string;
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
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Fetches the complete file tree from GitHub instantly,
 * bypassing git clone completely.
 */
export async function fetchGithubTree(
    repoUrl: string, 
    branch: string, 
    githubToken?: string
): Promise<{ nodes: TreeFileNode[], commitSha: string }> {
    // Parse owner and repo from URL
    // e.g. https://github.com/owner/repo
    const urlParts = repoUrl.replace(/\/$/, '').split('/');
    const repoName = urlParts.pop();
    const ownerName = urlParts.pop();

    if (!ownerName || !repoName) {
        throw new Error('Invalid GitHub repository URL');
    }

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'nb-s3-importer',
    };
    if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
    }

    const branchUrl = `https://api.github.com/repos/${ownerName}/${repoName}/branches/${branch}`;
    const branchRes = await fetch(branchUrl, { headers });
    if (!branchRes.ok) {
        throw new Error(`Failed to fetch GitHub branch: ${branchRes.statusText}`);
    }
    const branchData = await branchRes.json();
    const commitSha = branchData.commit.sha;

    const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/git/trees/${commitSha}?recursive=1`;
    
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
        throw new Error(`Failed to fetch GitHub tree: ${res.statusText}`);
    }

    const data = (await res.json()) as GithubTreeResponse;
    if (data.truncated) {
        console.warn(`[TreeAPI] Warning: The repository tree is truncated because it exceeds GitHub's limits.`);
    }

    const nodes: TreeFileNode[] = [];

    for (const entry of data.tree) {
        if (shouldIgnorePath(entry.path)) {
            continue;
        }

        if (entry.type === 'tree') {
            nodes.push({
                path: entry.path,
                name: entry.path.split('/').pop() || '',
                type: 'folder',
                sha: entry.sha,
                size: 0,
                mimeType: '',
            });
        } else if (entry.type === 'blob') {
            if (isTooLarge(entry.size)) {
                continue;
            }
            nodes.push({
                path: entry.path,
                name: entry.path.split('/').pop() || '',
                type: 'file',
                sha: entry.sha,
                size: entry.size || 0,
                mimeType: getMimeType(entry.path),
            });
        }
    }

    return {
        nodes,
        commitSha,
    };
}
