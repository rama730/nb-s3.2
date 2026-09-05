import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile, lstat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  validateSyncPath,
  commitIdentity,
  contentHashes,
  assertSafeSyncContent,
  type SyncManifest,
} from "./sync-contract";
import { withGitCredentialEnv } from "./git-auth";
import { runWithConcurrency } from "@/lib/utils/concurrency";

const exec = promisify(execFile);

/** A fresh checkout with an explicit remote removes the old local-cache-origin ambiguity. */
export async function publishGitSnapshot(input: {
  manifest: SyncManifest;
  runId: string;
  createdAt: Date;
  token: string | null;
  readContent: (key: string) => Promise<Buffer>;
  beforePush: (sha: string, branch: string) => Promise<void>;
}) {
  const { manifest } = input;
  const root = await mkdtemp(join(tmpdir(), "edge-reviewed-sync-"));
  const branch =
    manifest.mode === "pr" ? `edge/sync-${input.runId}` : manifest.branch;
  try {
    return await withGitCredentialEnv(input.token, async (credentialEnv) => {
      const identity = commitIdentity(manifest.files);
      const env = {
        ...credentialEnv,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_LITERAL_PATHSPECS: "1",
        GIT_AUTHOR_NAME: identity.author.name,
        GIT_AUTHOR_EMAIL: identity.author.email,
        GIT_COMMITTER_NAME: "NetworkBase Sync",
        GIT_COMMITTER_EMAIL: "sync@edge.invalid",
        GIT_AUTHOR_DATE: input.createdAt.toISOString(),
        GIT_COMMITTER_DATE: input.createdAt.toISOString(),
      };
      const git = async (...args: string[]) =>
        (
          await exec(
            "git",
            [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "commit.gpgSign=false",
              "-c",
              "http.followRedirects=false",
              "-C",
              root,
              ...args,
            ],
            { env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
          )
        ).stdout.trim();
      await git("init", "--initial-branch", branch);
      await git("remote", "add", "origin", manifest.repository);
      if (manifest.headSha) {
        if (!/^[a-f0-9]{40}$/.test(manifest.headSha))
          throw new Error("Invalid reviewed commit");
        await git(
          "fetch",
          "--depth=1",
          "--no-tags",
          "origin",
          manifest.headSha,
        );
        await git("checkout", "--detach", "FETCH_HEAD");
      }
      await runWithConcurrency(manifest.files, 24, async (file) => {
        validateSyncPath(file.path);
        // Never follow a repository symlink when materializing a reviewed file.
        let cursor = root;
        for (const segment of file.path.split("/")) {
          cursor = join(cursor, segment);
          try {
            if ((await lstat(cursor)).isSymbolicLink())
              throw new Error(
                `Symlink destination is not supported: ${file.path}`,
              );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        const target = join(root, file.path);
        if (file.snapshotKey) {
          const bytes = await input.readContent(file.snapshotKey);
          if (contentHashes(bytes).hash !== file.resultHash)
            throw new Error("Reviewed snapshot integrity check failed");
          assertSafeSyncContent(bytes);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes);
          await chmod(target, file.mode === "100755" ? 0o755 : 0o644);
        } else {
          try {
            await rm(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      });
      // ponytail: the checkout contains only the reviewed repository snapshot;
      // one native staging pass replaces thousands of git subprocesses.
      await git("add", "--all", "--", ".");
      if (!(await git("status", "--porcelain")))
        throw new Error(
          "The selected resolution does not change GitHub. Choose other files or resolutions.",
        );
      const message = `${manifest.message}\n\nNetworkBase-Sync-Operation: ${input.runId}${identity.trailers ? `\n${identity.trailers}` : ""}`;
      await git("commit", "--no-verify", "-m", message);
      const sha = await git("rev-parse", "HEAD");
      await input.beforePush(sha, branch);
      // Fast-forward-only; branch protections and concurrent remote changes fail closed.
      await git("push", "origin", `HEAD:refs/heads/${branch}`);
      const remote = await git(
        "ls-remote",
        "--heads",
        "origin",
        `refs/heads/${branch}`,
      );
      if (remote.split(/\s/)[0] !== sha)
        throw new Error(
          "Remote commit verification failed; review the operation before retrying",
        );
      return { commitSha: sha, branch, pushed: true };
    });
  } finally {
    // root is the exact directory allocated by mkdtemp, never a caller-provided path.
    await rm(root, { recursive: true, force: true });
  }
}
