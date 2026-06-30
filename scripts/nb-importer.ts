import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
config({ path: '.env.local' });

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

// Ignore common dependency/build folders
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    'out',
    '.vscode',
    '.idea',
]);

// Shannon Entropy Calculation
function calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const frequencies: Record<string, number> = {};
    for (let i = 0; i < len; i++) {
        const char = str[i]!;
        frequencies[char] = (frequencies[char] || 0) + 1;
    }
    let entropy = 0;
    for (const char in frequencies) {
        const p = frequencies[char]! / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

// Scan file for potential secrets
function scanForSecrets(content: string, filePath: string): Array<{ line: number; type: string; secret: string }> {
    const findings: Array<{ line: number; type: string; secret: string }> = [];
    const lines = content.split(/\r?\n/);

    const secretRegexes = [
        { name: 'Generic API Key/Secret', regex: /(api_key|secret|password|passwd|private_key|token|auth_token)\s*[:=]\s*['"]([a-zA-Z0-9_\-+=/]{16,})['"]/i },
        { name: 'Potential High-Entropy Hash', regex: /['"]([a-zA-Z0-9_\-+=/]{32,})['"]/ }
    ];

    for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i]!;
        for (const r of secretRegexes) {
            const match = lineContent.match(r.regex);
            if (match && match[2]) {
                const secretVal = match[2];
                const entropy = calculateEntropy(secretVal);
                if (entropy > 4.5) {
                    findings.push({
                        line: i + 1,
                        type: r.name,
                        secret: secretVal.substring(0, 4) + '...' + secretVal.substring(secretVal.length - 4),
                    });
                }
            }
        }
    }
    return findings;
}

interface FileInfo {
    relativePath: string;
    absolutePath: string;
    originalEol: 'LF' | 'CRLF' | 'CR' | 'MIXED' | 'UNKNOWN';
    normalizedContent: Buffer;
    size: number;
    mimeType: string;
    checksum: string;
}

async function scanDirectory(
    dir: string,
    rootDir: string,
    eolMode: 'lf' | 'crlf' | 'native'
): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const nativeEol = process.platform === 'win32' ? 'crlf' : 'lf';
    const targetEol = eolMode === 'native' ? nativeEol : eolMode;

    for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            files.push(...(await scanDirectory(fullPath, rootDir, eolMode)));
        } else if (entry.isFile()) {
            const rawContent = await fs.readFile(fullPath);
            const contentText = rawContent.toString('utf8');

            // EOL Detection
            let originalEol: FileInfo['originalEol'] = 'UNKNOWN';
            const hasLf = contentText.includes('\n');
            const hasCrlf = contentText.includes('\r\n');
            if (hasCrlf && contentText.replace(/\r\n/g, '').includes('\n')) {
                originalEol = 'MIXED';
            } else if (hasCrlf) {
                originalEol = 'CRLF';
            } else if (hasLf) {
                originalEol = 'LF';
            } else if (contentText.includes('\r')) {
                originalEol = 'CR';
            }

            // Normalization
            let normalizedText = contentText;
            if (targetEol === 'lf') {
                normalizedText = contentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            } else if (targetEol === 'crlf') {
                normalizedText = contentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
            }

            const normalizedContent = Buffer.from(normalizedText, 'utf8');
            const checksum = crypto.createHash('sha256').update(normalizedContent).digest('hex');

            files.push({
                relativePath,
                absolutePath: fullPath,
                originalEol,
                normalizedContent,
                size: normalizedContent.length,
                mimeType: getMimeType(entry.name),
                checksum,
            });
        }
    }
    return files;
}

async function main() {
    // Parse arguments
    let projectId = '';
    let targetPath = '';
    let eolMode: 'lf' | 'crlf' | 'native' = 'native';
    let email = process.env.SUPABASE_USER_EMAIL || '';
    let password = process.env.SUPABASE_USER_PASSWORD || '';
    let serverUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    let jobId = '';

    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--projectId') {
            projectId = args[i + 1] || '';
        } else if (args[i] === '--path') {
            targetPath = args[i + 1] || '';
        } else if (args[i] === '--eol') {
            const val = args[i + 1];
            if (val === 'lf' || val === 'crlf' || val === 'native') {
                eolMode = val;
            }
        } else if (args[i] === '--email') {
            email = args[i + 1] || '';
        } else if (args[i] === '--password') {
            password = args[i + 1] || '';
        } else if (args[i] === '--server') {
            serverUrl = args[i + 1] || '';
        } else if (args[i] === '--jobId') {
            jobId = args[i + 1] || '';
        }
    }

    if (!targetPath) {
        console.error('Error: --path is required.');
        process.exit(1);
    }
    if (!projectId && !jobId) {
        console.error('Error: Either --projectId or --jobId is required.');
        process.exit(1);
    }

    // Initialize Supabase Client for login if credentials provided
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be in .env.local');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    let authHeader = '';

    if (email && password) {
        console.log(`Authenticating user ${email} with Supabase...`);
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (authError || !authData.session) {
            console.error('Authentication failed:', authError?.message);
            process.exit(1);
        }
        console.log('Successfully authenticated!');
        authHeader = `sb-access-token=${authData.session.access_token}`;
    } else if (process.env.MOCK_USER_ID) {
        console.log('Using mock authentication (MOCK_USER_ID)...');
    } else {
        console.log('Warning: No email/password supplied. Request might fail if endpoints require auth.');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(authHeader ? { Cookie: authHeader } : {}),
    };

    console.log(`Scanning local files under: ${targetPath}`);
    const resolvedPath = path.resolve(targetPath);
    const scannedFiles = await scanDirectory(resolvedPath, resolvedPath, eolMode);
    console.log(`Scanned ${scannedFiles.length} files.`);

    // EOL normalizations preview
    console.log('\n--- Line Ending Normalization Preview ---');
    const eolStats = { LF: 0, CRLF: 0, MIXED: 0, CR: 0, UNKNOWN: 0 };
    for (const f of scannedFiles) {
        eolStats[f.originalEol]++;
    }
    console.log(`Original Line Endings in project:`);
    console.log(`  LF:    ${eolStats.LF}`);
    console.log(`  CRLF:  ${eolStats.CRLF}`);
    console.log(`  MIXED: ${eolStats.MIXED}`);
    console.log(`  CR:    ${eolStats.CR}`);
    console.log(`Target Line Ending Normalization: ${eolMode.toUpperCase()}`);

    // Secret scanning checks
    console.log('\n--- Secret Scanner Checks ---');
    let secretViolations = 0;
    for (const f of scannedFiles) {
        const findings = scanForSecrets(f.normalizedContent.toString('utf8'), f.relativePath);
        if (findings.length > 0) {
            secretViolations += findings.length;
            console.warn(`[WARNING] Secret detected in ${f.relativePath}:`);
            for (const finding of findings) {
                console.warn(`  Line ${finding.line}: [${finding.type}] value=${finding.secret}`);
            }
        }
    }
    if (secretViolations === 0) {
        console.log('No secrets detected in scanned files.');
    } else {
        console.warn(`[WARNING] Found ${secretViolations} potential secrets/API keys! Proceed with caution.`);
    }

    console.log('\n--- Repository Ingestion ---');
    let filesToUpload = scannedFiles;

    // Resumption workflow
    if (jobId) {
        console.log(`Resuming existing job: ${jobId}`);
        const statusUrl = `${serverUrl}/api/v1/github/import/status?jobId=${jobId}`;
        const res = await fetch(statusUrl, { headers });
        if (!res.ok) {
            console.error(`Failed to fetch job status: ${res.statusText}`);
            process.exit(1);
        }
        const body = await res.json();
        if (!body.success) {
            console.error('Failed to parse status body:', body.error);
            process.exit(1);
        }

        const data = body.data;
        projectId = data.projectId;
        console.log(`Found job status: ${data.status}. Total files: ${data.totalFiles}, Processed: ${data.processedFiles}`);

        if (data.status === 'completed') {
            console.log('Job is already completed!');
            process.exit(0);
        }

        const incompletePaths = new Set(data.incompleteFiles.map((f: any) => f.path));
        filesToUpload = scannedFiles.filter((f) => incompletePaths.has(f.relativePath));
        console.log(`Resuming upload: ${filesToUpload.length} files remaining out of ${scannedFiles.length}.`);
    } else {
        // Create new import job
        // 1. Generate Manifest
        const manifest = {
            files: scannedFiles.map((f) => ({
                path: f.relativePath,
                size: f.size,
                checksum: f.checksum,
            })),
        };
        const manifestText = JSON.stringify(manifest, null, 2);
        const manifestHash = crypto.createHash('sha256').update(manifestText).digest('hex');

        console.log(`Initializing import job on server...`);
        const initRes = await fetch(`${serverUrl}/api/v1/github/import/init`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                projectId,
                manifestHash,
                totalFiles: scannedFiles.length,
            }),
        });

        if (!initRes.ok) {
            console.error(`Failed to initialize import job:`, await initRes.text());
            process.exit(1);
        }

        const initBody = await initRes.json();
        if (!initBody.success) {
            console.error('Initialization response error:', initBody.error);
            process.exit(1);
        }

        jobId = initBody.data.jobId;
        const manifestSignedUrl = initBody.data.signedUrl;

        console.log(`Job initialized with ID: ${jobId}`);
        console.log(`Uploading manifest...`);

        const manifestUploadRes = await fetch(manifestSignedUrl, {
            method: 'PUT',
            body: manifestText,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!manifestUploadRes.ok) {
            console.error('Failed to upload manifest to Supabase Storage:', await manifestUploadRes.text());
            process.exit(1);
        }

        console.log(`Finalizing manifest verification...`);
        const finalizeManifestRes = await fetch(`${serverUrl}/api/v1/github/import/finalize-manifest`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jobId,
                manifestHash,
            }),
        });

        if (!finalizeManifestRes.ok) {
            console.error('Failed to finalize manifest on server:', await finalizeManifestRes.text());
            process.exit(1);
        }
        console.log('Manifest finalized and job state set to importing.');
    }

    // Upload Files Loop
    console.log(`\nUploading ${filesToUpload.length} files...`);
    let completedCount = 0;

    for (const file of filesToUpload) {
        console.log(`[${++completedCount}/${filesToUpload.length}] Uploading ${file.relativePath}...`);

        try {
            // Get file intent / signed URL
            const intentRes = await fetch(`${serverUrl}/api/v1/github/import/file-intent`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jobId,
                    path: file.relativePath,
                    size: file.size,
                    mimeType: file.mimeType,
                    checksum: file.checksum,
                }),
            });

            if (!intentRes.ok) {
                console.error(`  Failed to register file intent:`, await intentRes.text());
                continue;
            }

            const intentBody = await intentRes.json();
            if (!intentBody.success) {
                console.error(`  File intent error:`, intentBody.error);
                continue;
            }

            const { uploadIntentId, signedUrl } = intentBody.data;

            // Upload actual content to S3
            const fileUploadRes = await fetch(signedUrl, {
                method: 'PUT',
                body: file.normalizedContent as any,
                headers: {
                    'Content-Type': file.mimeType,
                },
            });

            if (!fileUploadRes.ok) {
                console.error(`  Failed to upload file content to S3:`, await fileUploadRes.text());
                continue;
            }

            // Finalize file record
            const finalizeRes = await fetch(`${serverUrl}/api/v1/github/import/finalize-file`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jobId,
                    path: file.relativePath,
                    uploadIntentId,
                }),
            });

            if (!finalizeRes.ok) {
                console.error(`  Failed to finalize file import on server:`, await finalizeRes.text());
                continue;
            }

            const finalizeBody = await finalizeRes.json();
            if (!finalizeBody.success) {
                console.error(`  Finalize response error:`, finalizeBody.error);
                continue;
            }

            console.log(`  Successfully finalized file. NodeID: ${finalizeBody.data.nodeId}, Version: ${finalizeBody.data.version}`);
        } catch (err) {
            console.error(`  Unexpected error uploading file ${file.relativePath}:`, err);
        }
    }

    console.log(`\nImport Process Finished! Check progress with:`);
    console.log(`tsx scripts/nb-importer.ts --path ${targetPath} --jobId ${jobId}`);
}

main().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
});
