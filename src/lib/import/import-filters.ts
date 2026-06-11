/**
 * Shared import filters to keep UI preview and importer consistent.
 * Keep this tiny + dependency-free (pure optimization).
 */

export const IGNORED_DIRS = new Set([
  '.git',
  '.github',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'vendor',
  '.DS_Store',
  'coverage',
  '.nyc_output',
  '.vercel',
  '.netlify',
  '.serverless',
  '__pycache__',
  '.pytest_cache',
  '.tox',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
  'logs'
]);

// Skip large files (> 25MB) to avoid timeouts/memory spikes.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function shouldIgnorePath(pathLike: string): boolean {
  const v = (pathLike || '').trim();
  if (!v) return false;
  // Normalize to forward slashes for GitHub paths; split on both for safety.
  const parts = v.split(/[\\/]+/g).filter(Boolean);
  return parts.some((p) => IGNORED_DIRS.has(p));
}

export function isTooLarge(bytes: number | null | undefined): boolean {
  if (bytes == null) return false;
  return bytes > MAX_FILE_BYTES;
}

