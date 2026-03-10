"use client";

import React, { useCallback } from "react";
import { Download, GitBranch, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useToast } from "@/components/ui-custom/Toast";
import { filesFeatureFlags } from "@/lib/features/files";
import { isFilesHardeningEnabled } from "@/lib/features/files";
import { useAuth } from "@/hooks/useAuth";
import {
  getGitStatus,
  pushToGitHub,
  pullFromGitHub,
} from "@/app/actions/git";
import { cn } from "@/lib/utils";

interface WorkspaceGitToolbarProps {
  projectId: string;
  canEdit: boolean;
}

export function WorkspaceGitToolbar({
  projectId,
  canEdit,
}: WorkspaceGitToolbarProps) {
  const { user } = useAuth();
  const filesHardeningEnabled = isFilesHardeningEnabled(user?.id ?? null);
  const { showToast } = useToast();

  const git = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.git);
  const setGitRepo = useFilesWorkspaceStore((s) => s.setGitRepo);
  const setGitSyncStatus = useFilesWorkspaceStore((s) => s.setGitSyncStatus);
  const setGitChangedFiles = useFilesWorkspaceStore((s) => s.setGitChangedFiles);
  const setGitCommitMessage = useFilesWorkspaceStore((s) => s.setGitCommitMessage);
  const setGitLastSync = useFilesWorkspaceStore((s) => s.setGitLastSync);
  const setExplorerMode = useFilesWorkspaceStore((s) => s.setExplorerMode);

  const connected = !!git?.repoUrl;
  const syncing = git?.syncInProgress ?? false;
  const hasChanges = (git?.changedFiles?.length ?? 0) > 0;
  const isLoading = syncing;

  const loadStatus = useCallback(async () => {
    try {
      const status = await getGitStatus(projectId);
      if (status.connected && status.repoUrl) {
        setGitRepo(projectId, status.repoUrl, status.branch ?? "main");
        setGitChangedFiles(
          projectId,
          status.changedFiles.map((f) => ({
            nodeId: f.nodeId,
            status: f.status as "modified" | "added" | "deleted",
          }))
        );
        if (status.lastSyncAt && status.lastCommitSha) {
          setGitLastSync(projectId, status.lastSyncAt, status.lastCommitSha);
        }
      }
    } catch {
      // Silently fail
    }
  }, [
    projectId,
    setGitRepo,
    setGitChangedFiles,
    setGitLastSync,
  ]);

  const handlePush = useCallback(async () => {
    if (!canEdit) return;
    if (!hasChanges) {
      showToast("No changes to push", "info");
      return;
    }
    const msg = git?.commitMessage?.trim();
    if (!msg) {
      showToast("Enter a commit message in Source Control (sidebar) first", "info");
      setExplorerMode(projectId, "sourceControl");
      return;
    }
    setGitSyncStatus(projectId, true);
    const result = await pushToGitHub(projectId, msg);
    if (result.success) {
      showToast("Push started. Syncing in background...", "success");
      setGitCommitMessage(projectId, "");
      setTimeout(() => {
        void loadStatus();
        setGitSyncStatus(projectId, false);
      }, 5000);
    } else {
      showToast(result.error ?? "Push failed", "error");
      setGitSyncStatus(projectId, false);
    }
  }, [
    canEdit,
    git?.commitMessage,
    hasChanges,
    loadStatus,
    projectId,
    setExplorerMode,
    setGitCommitMessage,
    setGitSyncStatus,
    showToast,
  ]);

  const handlePull = useCallback(async () => {
    if (!canEdit) return;
    setGitSyncStatus(projectId, true);
    const result = await pullFromGitHub(projectId);
    if (result.success) {
      showToast("Pull started. Syncing in background...", "success");
      setTimeout(() => {
        void loadStatus();
        setGitSyncStatus(projectId, false);
      }, 5000);
    } else {
      showToast(result.error ?? "Pull failed", "error");
      setGitSyncStatus(projectId, false);
    }
  }, [canEdit, loadStatus, projectId, setGitSyncStatus, showToast]);

  if (!filesHardeningEnabled || !filesFeatureFlags.wave4GitIntegration) return null;

  if (!connected) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => setExplorerMode(projectId, "sourceControl")}
        title="Open Source Control to connect a repository"
      >
        <GitBranch className="w-3.5 h-3.5 mr-1.5" />
        Source Control
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span
        className={cn(
          "text-[10px] text-zinc-500 truncate max-w-[80px]",
          hasChanges && "text-amber-600 dark:text-amber-400"
        )}
        title={git?.branch ?? "main"}
      >
        {git?.branch ?? "main"}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0"
        onClick={() => void handlePull()}
        disabled={!canEdit || isLoading}
        title="Pull latest from GitHub"
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => void handlePush()}
        disabled={!canEdit || isLoading || !hasChanges}
        title={
          hasChanges && !git?.commitMessage?.trim()
            ? "Enter commit message in Source Control"
            : "Commit & Push to GitHub"
        }
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
        ) : (
          <Upload className="w-3.5 h-3.5 mr-1" />
        )}
        Push
      </Button>
    </div>
  );
}
