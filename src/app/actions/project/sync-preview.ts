'use server';

import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccessById } from "@/lib/data/project-access";
import { fetchGithubTree } from "@/lib/github/tree-api";
import {
  GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE,
  GITHUB_CONNECTION_REQUIRED_MESSAGE,
  resolveGithubExternalAccountHealth,
} from "@/lib/github/account-health";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import {
  compareGithubSyncTrees,
  type GithubSyncConflictItem,
} from "@/lib/github/sync-preview-comparison";

export type SyncConflictItem = GithubSyncConflictItem;

export interface SyncPreviewResult {
  success: boolean;
  error?: string;
  hasConflicts?: boolean;
  conflicts?: SyncConflictItem[];
  incomingUpdatesCount?: number;
  newCommitSha?: string;
  syncedAt?: string;
}

export async function getSyncPreviewAction(projectId: string): Promise<SyncPreviewResult> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
      return { success: false, error: "Project not found" };
    }
    if (!access.canWrite) {
      return { success: false, error: "Unauthorized" };
    }

    const [project] = await db
      .select({
        id: projects.id,
        importSource: projects.importSource,
        githubLastCommitSha: projects.githubLastCommitSha,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const src = project.importSource as any;
    if (!src || src.type !== "github" || !src.repoUrl) {
      return { success: false, error: "Project is not imported from GitHub" };
    }

    const githubToken = session?.provider_token || null;
    const repoUrl = src.repoUrl;
    const branch = src.branch || "main";
    const githubConnection = buildGithubAccountConnectionState(user);
    const [githubAccountHealth, githubAccess] = await Promise.all([
      resolveGithubExternalAccountHealth({
        linked: githubConnection.linked,
        username: githubConnection.username,
      }),
      resolveGithubRepoAccess({
        repoUrl,
        oauthToken: githubToken,
        preferredInstallationId: src?.metadata?.githubInstallationId ?? null,
        sealedImportToken: src?.metadata?.importAuth,
      }),
    ]);

    const accountCannotAuthorize =
      githubAccess.source !== "app" &&
      (githubAccountHealth.state === "unavailable" || !githubConnection.linked);

    // 1. Fetch remote tree from GitHub
    let treeData;
    try {
      treeData = await fetchGithubTree(
        repoUrl,
        branch,
        accountCannotAuthorize ? undefined : githubAccess.token || undefined,
      );
    } catch (error) {
      if (accountCannotAuthorize) {
        return {
          success: false,
          error: githubAccountHealth.state === "unavailable"
            ? GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE
            : GITHUB_CONNECTION_REQUIRED_MESSAGE,
        };
      }
      throw error;
    }
    const remoteNodes = treeData.nodes.filter((n) => n.type === "file");

    // 2. Fetch local active nodes from DB
    const localNodes = await db
      .select({
        id: projectNodes.id,
        path: projectNodes.path,
        gitHash: projectNodes.gitHash,
        s3Key: projectNodes.s3Key,
        updatedAt: projectNodes.updatedAt,
      })
      .from(projectNodes)
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          isNull(projectNodes.deletedAt),
          eq(projectNodes.type, "file")
        )
      );

    const { conflicts, incomingUpdatesCount } = compareGithubSyncTrees(
      remoteNodes,
      localNodes,
    );

    // A successful zero-diff check is a completed sync operation. Reconcile a
    // stale failure here while the remote tree and local state are both still
    // authoritative. In-flight workers are protected by the status predicate.
    let syncedAt: string | undefined;
    if (conflicts.length === 0 && incomingUpdatesCount === 0) {
      const syncedAtDate = new Date();
      syncedAt = syncedAtDate.toISOString();
      const metadata =
        src.metadata && typeof src.metadata === "object" ? src.metadata : {};

      await db
        .update(projects)
        .set({
          syncStatus: "ready",
          githubLastSyncAt: syncedAtDate,
          githubLastCommitSha: treeData.commitSha || project.githubLastCommitSha,
          importSource: {
            ...src,
            metadata: {
              ...metadata,
              lastError: null,
              syncPhase: "ready",
              syncProgress: null,
              lastValidatedAt: syncedAt,
            },
          } as any,
          updatedAt: syncedAtDate,
        })
        .where(
          and(
            eq(projects.id, projectId),
            inArray(projects.syncStatus, ["ready", "failed"]),
          ),
        );
    }

    return {
      success: true,
      hasConflicts: conflicts.length > 0,
      conflicts,
      incomingUpdatesCount,
      newCommitSha: treeData.commitSha,
      syncedAt,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to fetch sync preview",
    };
  }
}
