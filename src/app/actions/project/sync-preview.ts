'use server';

import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccessById } from "@/lib/data/project-access";
import { fetchGithubTree } from "@/lib/github/tree-api";

export interface SyncConflictItem {
  path: string;
  name: string;
  localModifiedAt: string | null;
}

export interface SyncPreviewResult {
  success: boolean;
  error?: string;
  hasConflicts?: boolean;
  conflicts?: SyncConflictItem[];
  incomingUpdatesCount?: number;
  newCommitSha?: string;
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

    // 1. Fetch remote tree from GitHub
    const treeData = await fetchGithubTree(repoUrl, branch, githubToken || undefined);
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

    const localMap = new Map(localNodes.map((n) => [n.path, n]));

    const conflicts: SyncConflictItem[] = [];
    let incomingUpdatesCount = 0;

    // 3. Perform three-way comparison
    for (const remote of remoteNodes) {
      const normalizedRemotePath = `/${remote.path.replace(/^\//, "")}`;
      const local = localMap.get(normalizedRemotePath);

      if (local) {
        const isLocallyModified = local.s3Key !== null;
        const isRemoteModified = local.gitHash !== remote.sha;

        if (isRemoteModified) {
          if (isLocallyModified) {
            // Both remote and local are modified -> CONFLICT
            conflicts.push({
              path: remote.path,
              name: remote.name,
              localModifiedAt: local.updatedAt ? local.updatedAt.toISOString() : null,
            });
          } else {
            // Only remote is modified -> Safe Update
            incomingUpdatesCount++;
          }
        }
      } else {
        // Path absent locally -> Safe New File
        incomingUpdatesCount++;
      }
    }

    // 4. Remote deletions warning (edge-case)
    const remotePaths = new Set(remoteNodes.map((n) => `/${n.path.replace(/^\//, "")}`));
    for (const local of localNodes) {
      if (!remotePaths.has(local.path)) {
        const isLocallyModified = local.s3Key !== null;
        if (isLocallyModified) {
          conflicts.push({
            path: local.path.replace(/^\//, ""),
            name: local.path.split("/").pop() || "",
            localModifiedAt: local.updatedAt ? local.updatedAt.toISOString() : null,
          });
        }
      }
    }

    return {
      success: true,
      hasConflicts: conflicts.length > 0,
      conflicts,
      incomingUpdatesCount,
      newCommitSha: treeData.commitSha,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to fetch sync preview",
    };
  }
}
