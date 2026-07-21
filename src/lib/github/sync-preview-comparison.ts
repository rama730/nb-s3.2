export interface GithubSyncConflictItem {
  path: string;
  name: string;
  localModifiedAt: string | null;
}

type RemoteFile = {
  path: string;
  name: string;
  sha: string | null;
};

type LocalFile = {
  path: string;
  gitHash: string | null;
  s3Key: string | null;
  updatedAt: Date | null;
};

export function compareGithubSyncTrees(
  remoteFiles: RemoteFile[],
  localFiles: LocalFile[],
) {
  const localByPath = new Map(localFiles.map((file) => [file.path, file]));
  const conflicts: GithubSyncConflictItem[] = [];
  let incomingUpdatesCount = 0;

  for (const remote of remoteFiles) {
    const normalizedRemotePath = `/${remote.path.replace(/^\//, "")}`;
    const local = localByPath.get(normalizedRemotePath);

    if (!local) {
      incomingUpdatesCount++;
      continue;
    }

    if (local.gitHash === remote.sha) continue;

    if (local.s3Key !== null) {
      conflicts.push({
        path: remote.path,
        name: remote.name,
        localModifiedAt: local.updatedAt?.toISOString() ?? null,
      });
    } else {
      incomingUpdatesCount++;
    }
  }

  const remotePaths = new Set(
    remoteFiles.map((file) => `/${file.path.replace(/^\//, "")}`),
  );
  for (const local of localFiles) {
    if (remotePaths.has(local.path)) continue;

    if (local.s3Key !== null) {
      conflicts.push({
        path: local.path.replace(/^\//, ""),
        name: local.path.split("/").pop() || "",
        localModifiedAt: local.updatedAt?.toISOString() ?? null,
      });
    } else {
      incomingUpdatesCount++;
    }
  }

  return { conflicts, incomingUpdatesCount };
}
