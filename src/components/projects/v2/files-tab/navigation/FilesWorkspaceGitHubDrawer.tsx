"use client";
import { GitHubSyncDrawer } from "./GitHubSyncDrawer";
import { useFilesWorkspaceView } from "../FilesWorkspaceViews";

export function FilesWorkspaceGitHubDrawer({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const workspace = useFilesWorkspaceView()!;
  return enabled &&
    workspace.view === "project" &&
    workspace.inspector === "github" ? (
    <GitHubSyncDrawer
      projectId={projectId}
      onClose={() => workspace.setInspector(null)}
    />
  ) : null;
}
