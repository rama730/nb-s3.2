import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  classifySyncFile,
  contentHashes,
  commitIdentity,
  validateSyncPath,
  excludedSyncPath,
  assertSafeSyncContent,
  detectIncomingRenames,
  redactSyncManifest,
  type SyncManifest,
  type SyncFile,
} from "../../src/lib/github/sync-contract";
import { publishGitSnapshot } from "../../src/lib/github/sync-git";
const exec = promisify(execFile);
const git = async (...args: string[]) =>
  (await exec("git", args)).stdout.trim();
function file(overrides: Partial<SyncFile> = {}): SyncFile {
  const bytes = Buffer.from("hello\n");
  const hashes = contentHashes(bytes);
  return {
    path: "README.md",
    nodeId: "node",
    version: 1,
    storageKey: "private-key",
    localHash: hashes.hash,
    localBlobSha: hashes.blobSha,
    remoteSha: null,
    baseSha: null,
    baseCommit: null,
    baseSequence: 0,
    size: bytes.length,
    mimeType: "text/plain",
    mode: "100644",
    change: "add",
    blocked: null,
    contributors: [],
    snapshotKey: "snapshot",
    resultHash: hashes.hash,
    resultBlobSha: hashes.blobSha,
    ...overrides,
  };
}
function manifest(repository: string, files = [file()]): SyncManifest {
  return {
    repository,
    repositoryId: 1,
    branch: "main",
    headSha: null,
    connectionVersion: 1,
    sequence: 1,
    direction: "push",
    mode: "direct",
    message: "Publish reviewed project files",
    files,
  };
}
test("three-way comparison never treats an unknown baseline as overwrite permission", () => {
  for (const direction of ["push", "pull"] as const) {
    assert.equal(
      classifySyncFile(direction, "same", "same", undefined),
      "unchanged",
    );
    assert.equal(
      classifySyncFile(direction, "edge", "github", undefined),
      "conflict",
    );
    assert.equal(
      classifySyncFile(direction, "edge", "github", "base"),
      "conflict",
    );
  }
  assert.equal(classifySyncFile("push", "new", "base", "base"), "modify");
  assert.equal(classifySyncFile("pull", "base", "new", "base"), "modify");
  assert.equal(classifySyncFile("push", null, "base", "base"), "delete");
  assert.equal(classifySyncFile("pull", "base", null, "base"), "delete");
  assert.equal(
    classifySyncFile("push", null, "remote", undefined),
    "unchanged",
  );
  assert.equal(classifySyncFile("pull", "local", null, undefined), "unchanged");
  assert.equal(classifySyncFile("pull", "edited", null, "base"), "conflict");
});
test("paths, secrets, unsupported pointers, and server-only data are guarded", () => {
  for (const path of [
    "../secret",
    "/tmp/file",
    "src/../../file",
    "a\\b",
    ".git/config",
    "a\0b",
  ])
    assert.throws(() => validateSyncPath(path));
  assert.ok(excludedSyncPath(".system/task-drafts/a.txt"));
  assert.ok(excludedSyncPath(".env.local"));
  assert.ok(excludedSyncPath("codeql-db/results/cache.bin"));
  assert.ok(excludedSyncPath(".rohkun/analysis/index.json"));
  assert.equal(excludedSyncPath(".env.example"), null);
  assert.throws(() =>
    assertSafeSyncContent(Buffer.from("-----BEGIN PRIVATE KEY-----")),
  );
  assert.throws(() =>
    assertSafeSyncContent(
      Buffer.from("version https://git-lfs.github.com/spec/v1\n"),
    ),
  );
  const redacted = redactSyncManifest(manifest("test"));
  assert.equal(redacted.files[0]?.storageKey, null);
  assert.equal(redacted.files[0]?.snapshotKey, undefined);
});
test("credit uses approved actual editors and does not invent the publisher as author", () => {
  const authors = [1, 2].map((id) => ({
    userId: String(id),
    name: `Editor ${id}`,
    username: `editor${id}`,
    avatarUrl: null,
    githubLogin: `editor${id}`,
    githubId: id,
    email: `${id}+editor${id}@users.noreply.github.com`,
    source: "edge" as const,
  }));
  const identity = commitIdentity([
    file({ contributors: [...authors, authors[0]!] }),
  ]);
  assert.equal(identity.author.name, "NetworkBase Sync");
  assert.equal(identity.trailers.split("\n").length, 2);
  assert.equal(
    commitIdentity([file({ contributors: [authors[0]!] })]).author.name,
    "Editor 1",
  );
  assert.equal(commitIdentity([file()]).trailers, "");
});
test("unambiguous incoming rename preserves canonical file identity; ambiguous copies do not", () => {
  const before = file({
    path: "old.txt",
    change: "delete",
    localBlobSha: "same",
    baseSha: "same",
    remoteSha: null,
  });
  const after = file({
    path: "new.txt",
    nodeId: null,
    storageKey: null,
    localBlobSha: null,
    change: "add",
    remoteSha: "same",
  });
  const result = detectIncomingRenames([before, after]);
  assert.equal(result[1]?.change, "rename");
  assert.equal(result[1]?.nodeId, before.nodeId);
  assert.equal(result[1]?.renamedFrom, "old.txt");
  assert.equal(result[0]?.change, "unchanged");
  assert.equal(
    detectIncomingRenames([before, after, { ...after, path: "copy.txt" }])[1]
      ?.change,
    "add",
  );
});
test("native publisher pushes the actual remote, preserves executable mode, and cannot overwrite concurrent commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "networkbase-sync-test-"));
  const remote = join(root, "remote.git");
  try {
    await git("init", "--bare", remote);
    const bytes = Buffer.from("hello\n");
    const first = await publishGitSnapshot({
      manifest: manifest(remote, [file({ mode: "100755" })]),
      runId: "first",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      token: null,
      readContent: async () => bytes,
      beforePush: async () => {},
    });
    assert.equal(
      await git("--git-dir", remote, "rev-parse", "refs/heads/main"),
      first.commitSha,
    );
    assert.equal(
      await git("--git-dir", remote, "show", "main:README.md"),
      "hello",
    );
    assert.match(await git("--git-dir", remote, "ls-tree", "main"), /^100755/);
    const updated = Buffer.from("updated\n");
    const hashes = contentHashes(updated);
    const next = {
      ...manifest(remote, [
        file({ resultHash: hashes.hash, resultBlobSha: hashes.blobSha }),
      ]),
      headSha: first.commitSha,
    };
    const second = await publishGitSnapshot({
      manifest: next,
      runId: "second",
      createdAt: new Date("2026-09-01T00:01:00Z"),
      token: null,
      readContent: async () => updated,
      beforePush: async () => {},
    });
    await assert.rejects(
      publishGitSnapshot({
        manifest: { ...next, message: "Stale overwrite attempt" },
        runId: "stale",
        createdAt: new Date("2026-09-01T00:02:00Z"),
        token: null,
        readContent: async () => updated,
        beforePush: async () => {},
      }),
    );
    assert.equal(
      await git("--git-dir", remote, "rev-parse", "main"),
      second.commitSha,
    );
    const pr = await publishGitSnapshot({
      manifest: { ...next, mode: "pr", message: "Proposed change" },
      runId: "review",
      createdAt: new Date("2026-09-01T00:03:00Z"),
      token: null,
      readContent: async () => updated,
      beforePush: async () => {},
    });
    assert.equal(pr.branch, "networkbase/sync-review");
    assert.equal(
      await git("--git-dir", remote, "rev-parse", "main"),
      second.commitSha,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("native publication treats pathspec-like filenames literally", async () => {
  const root = await mkdtemp(join(tmpdir(), "networkbase-sync-literal-test-"));
  const remote = join(root, "remote.git");
  try {
    await git("init", "--bare", remote);
    await publishGitSnapshot({
      manifest: manifest(remote, [file({ path: ":(glob)literal.txt" })]),
      runId: "literal",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      token: null,
      readContent: async () => Buffer.from("hello\n"),
      beforePush: async () => {},
    });
    assert.equal(
      await git("--git-dir", remote, "show", "main::(glob)literal.txt"),
      "hello",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
