import { createHash } from "node:crypto";
import { GITHUB_SYNC_LIMITS } from "./sync-limits";

export { GITHUB_SYNC_LIMITS as SYNC_LIMITS } from "./sync-limits";
export const GITHUB_WORKFLOW_PERMISSION_ERROR =
  "GitHub workflow permission is required to publish files in .github/workflows. Authorize workflow publishing, then retry this reviewed operation.";

export function includesGithubWorkflowFiles(paths: Iterable<string>) {
  for (const path of paths) {
    if (path.startsWith(".github/workflows/")) return true;
  }
  return false;
}

export function isGithubWorkflowPermissionError(message?: string | null) {
  return Boolean(message?.includes(GITHUB_WORKFLOW_PERMISSION_ERROR));
}
export type SyncDirection = "push" | "pull";
export type SyncStatus =
  | "review"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "needs_review"
  | "cancelled";
export type SyncResolution = "edge" | "github" | "merge";
export interface SyncContributor {
  userId: string | null;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
  githubId: number | null;
  email?: string | null;
  source: "edge" | "github";
}
export interface SyncFile {
  path: string;
  renamedFrom?: string;
  nodeId: string | null;
  version: number | null;
  storageKey: string | null;
  localHash: string | null;
  localBlobSha: string | null;
  remoteSha: string | null;
  baseSha: string | null;
  baseCommit: string | null;
  baseSequence: number;
  size: number;
  mimeType: string;
  mode: string;
  change: "add" | "modify" | "delete" | "rename" | "conflict" | "unchanged";
  blocked: string | null;
  contributors: SyncContributor[];
  snapshotKey?: string;
  resultHash?: string;
  resultBlobSha?: string;
  resolution?: SyncResolution;
}
export interface SyncManifest {
  repository: string;
  repositoryId: number | null;
  branch: string;
  headSha: string | null;
  connectionVersion: number;
  sequence: number;
  direction: SyncDirection;
  mode: "direct" | "pr";
  message: string;
  files: SyncFile[];
  newRepository?: {
    owner: string;
    name: string;
    private: boolean;
    organization: boolean;
  };
}
export interface SyncResult {
  commitSha?: string;
  branch?: string;
  repositoryId?: number;
  repositoryCreated?: boolean;
  pushed?: boolean;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  merged?: boolean;
  applied?: string[];
  snapshotsCleaned?: boolean;
}
export interface SyncRunView {
  id: string;
  status: SyncStatus;
  stage: string;
  error: string | null;
  direction: SyncDirection;
  createdAt: string;
  manifest: SyncManifest;
  result: SyncResult;
}

export function contentHashes(content: Buffer) {
  return {
    hash: createHash("sha256").update(content).digest("hex"),
    blobSha: createHash("sha1")
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest("hex"),
  };
}

export function validateSyncPath(value: string): string {
  if (
    !value ||
    value.length > 2048 ||
    value.startsWith("/") ||
    /[\\\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("Invalid repository path");
  const parts = value.split("/");
  if (
    parts.some(
      (p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git",
    )
  )
    throw new Error("Unsafe repository path");
  return value;
}

export function excludedSyncPath(path: string): string | null {
  try {
    validateSyncPath(path);
  } catch {
    return "Unsafe repository path";
  }
  if (
    /(^|\/)(node_modules|\.next|\.cache|dist|coverage|codeql-db|\.rohkun)(\/|$)/i.test(
      path,
    )
  )
    return "Generated or dependency files";
  if (/(^|\/)\.system(\/|$)/i.test(path)) return "Private task-system files";
  if (
    /(^|\/)(\.env($|\.)|id_(rsa|ed25519)|credentials(?:\.|$)|\.npmrc$|\.pypirc$)/i.test(
      path,
    ) &&
    !/\.env\.(example|sample|template)$/i.test(path)
  )
    return "Potential credentials";
  if (/\.(pem|p12|pfx|key)$/i.test(path)) return "Potential private key";
  return null;
}

export function assertSafeSyncContent(content: Buffer) {
  if (content.length > GITHUB_SYNC_LIMITS.fileBytes)
    throw new Error("File exceeds the 10 MB synchronization limit");
  const text = content.toString("utf8");
  if (
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b/.test(
      text,
    )
  )
    throw new Error(
      "Potential secret detected. Remove credentials before publishing.",
    );
  if (text.startsWith("version https://git-lfs.github.com/spec/v1"))
    throw new Error(
      "Git LFS pointers require an LFS client; this file cannot be synchronized here.",
    );
}

export function classifySyncFile(
  direction: SyncDirection,
  local: string | null,
  remote: string | null,
  base: string | null | undefined,
): SyncFile["change"] {
  if (local === remote) return "unchanged";
  // An unknown baseline is not permission to overwrite an existing destination.
  if (base === undefined) {
    if (local && remote) return "conflict";
    return direction === "push"
      ? local
        ? "add"
        : "unchanged"
      : remote
        ? "add"
        : "unchanged";
  }
  const source = direction === "push" ? local : remote;
  const destination = direction === "push" ? remote : local;
  if (destination !== base) return source === base ? "unchanged" : "conflict";
  return source === null ? "delete" : destination === null ? "add" : "modify";
}

/** Exact, unambiguous renames preserve file identity. Edited/ambiguous moves remain explicit conflicts. */
export function detectIncomingRenames(files: SyncFile[]): SyncFile[] {
  const result = files.map((file) => ({ ...file }));
  for (const incoming of result.filter(
    (file) =>
      file.change === "add" &&
      !file.blocked &&
      !file.storageKey &&
      file.remoteSha,
  )) {
    const candidates = result.filter(
      (file) =>
        file.change === "delete" &&
        !file.blocked &&
        file.storageKey &&
        file.localBlobSha === incoming.remoteSha &&
        file.baseSha === incoming.remoteSha,
    );
    const destinations = result.filter(
      (file) => file.change === "add" && file.remoteSha === incoming.remoteSha,
    );
    if (candidates.length !== 1 || destinations.length !== 1) continue;
    const previous = candidates[0]!;
    Object.assign(incoming, {
      renamedFrom: previous.path,
      nodeId: previous.nodeId,
      storageKey: previous.storageKey,
      version: previous.version,
      localHash: previous.localHash,
      localBlobSha: previous.localBlobSha,
      mimeType: previous.mimeType,
      change: "rename",
    });
    previous.change = "unchanged";
  }
  return result;
}

export function commitIdentity(files: SyncFile[]) {
  const authors = new Map<string, SyncContributor>();
  for (const file of files)
    for (const author of file.contributors) {
      if (
        author.email &&
        author.githubId &&
        !/[\r\n<>]/.test(author.name) &&
        /^[^\s<>]+@[^\s<>]+$/.test(author.email)
      )
        authors.set(String(author.githubId), author);
    }
  const values = [...authors.values()].sort(
    (a, b) => a.githubId! - b.githubId!,
  );
  return {
    author:
      values.length === 1
        ? { name: values[0]!.name, email: values[0]!.email! }
        : { name: "NetworkBase Sync", email: "sync@networkbase.invalid" },
    trailers:
      values.length > 1
        ? values.map((a) => `Co-authored-by: ${a.name} <${a.email}>`).join("\n")
        : "",
  };
}

export function redactSyncManifest(manifest: SyncManifest): SyncManifest {
  return {
    ...manifest,
    files: manifest.files.map((file) => ({
      ...file,
      storageKey: null,
      snapshotKey: undefined,
      contributors: file.contributors.map(
        ({ email: _email, ...author }) => author,
      ),
    })),
  };
}
