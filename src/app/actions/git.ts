"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { projects, projectNodes, projectNodeEvents } from "@/lib/db/schema";
import { eq, and, isNull, gt, like, desc } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { inngest } from "@/inngest/client";
import { randomUUID } from "crypto";

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;

async function requireProjectOwner(projectId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            githubRepoUrl: projects.githubRepoUrl,
            githubDefaultBranch: projects.githubDefaultBranch,
            githubLastSyncAt: projects.githubLastSyncAt,
            githubLastCommitSha: projects.githubLastCommitSha,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) throw new Error("Project not found");
    if (project.ownerId !== user.id) throw new Error("Forbidden");

    return { user, project };
}

export async function connectGitHubRepo(
    projectId: string,
    repoUrl: string,
    branch?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { user } = await requireProjectOwner(projectId);

        const rl = await consumeRateLimit(`git:connect:${user.id}`, 5, 3600);
        if (!rl.allowed) {
            return { success: false, error: "Rate limit exceeded. Try again later." };
        }

        const trimmedUrl = repoUrl.trim().replace(/\/+$/, "");
        if (!GITHUB_URL_RE.test(trimmedUrl)) {
            return { success: false, error: "Invalid GitHub repository URL." };
        }

        const resolvedBranch = branch?.trim() || "main";

        await db
            .update(projects)
            .set({
                githubRepoUrl: trimmedUrl,
                githubDefaultBranch: resolvedBranch,
            })
            .where(eq(projects.id, projectId));

        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}

export async function disconnectGitHubRepo(
    projectId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        await requireProjectOwner(projectId);

        await db
            .update(projects)
            .set({
                githubRepoUrl: null,
                githubDefaultBranch: "main",
                githubLastSyncAt: null,
                githubLastCommitSha: null,
            })
            .where(eq(projects.id, projectId));

        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}

export async function getGitStatus(projectId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            githubRepoUrl: projects.githubRepoUrl,
            githubDefaultBranch: projects.githubDefaultBranch,
            githubLastSyncAt: projects.githubLastSyncAt,
            githubLastCommitSha: projects.githubLastCommitSha,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) throw new Error("Project not found");

    const isPublic = project.visibility === "public";
    if (project.ownerId !== user.id && !isPublic) throw new Error("Forbidden");

    if (!project.githubRepoUrl) {
        return {
            connected: false,
            repoUrl: null,
            branch: "main",
            lastSyncAt: null,
            lastCommitSha: null,
            changedFiles: [],
        };
    }

    const changedConditions = [
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.type, "file"),
        isNull(projectNodes.deletedAt),
    ];
    if (project.githubLastSyncAt) {
        changedConditions.push(gt(projectNodes.updatedAt, project.githubLastSyncAt));
    }

    const changedRows = await db
        .select({
            nodeId: projectNodes.id,
            name: projectNodes.name,
        })
        .from(projectNodes)
        .where(and(...changedConditions))
        .limit(500);

    const changedFiles = changedRows.map((r) => ({
        nodeId: r.nodeId,
        name: r.name,
        status: "modified" as const,
    }));

    return {
        connected: true,
        repoUrl: project.githubRepoUrl,
        branch: project.githubDefaultBranch,
        lastSyncAt: project.githubLastSyncAt?.toISOString() ?? null,
        lastCommitSha: project.githubLastCommitSha,
        changedFiles,
    };
}

export async function pushToGitHub(
    projectId: string,
    commitMessage: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
        const { user, project } = await requireProjectOwner(projectId);
        if (!project.githubRepoUrl) {
            return { success: false, error: "No GitHub repository connected." };
        }

        const rl = await consumeRateLimit(`git:push:${user.id}`, 10, 3600);
        if (!rl.allowed) {
            return { success: false, error: "Rate limit exceeded. Try again later." };
        }

        const jobId = randomUUID();
        await inngest.send({
            name: "git/push",
            data: { projectId, commitMessage, userId: user.id },
            id: jobId,
        });

        return { success: true, jobId };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}

export async function pullFromGitHub(
    projectId: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
        const { user, project } = await requireProjectOwner(projectId);
        if (!project.githubRepoUrl) {
            return { success: false, error: "No GitHub repository connected." };
        }

        const rl = await consumeRateLimit(`git:pull:${user.id}`, 10, 3600);
        if (!rl.allowed) {
            return { success: false, error: "Rate limit exceeded. Try again later." };
        }

        const jobId = randomUUID();
        await inngest.send({
            name: "git/pull",
            data: { projectId, userId: user.id },
            id: jobId,
        });

        return { success: true, jobId };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}

export async function getGitBranches(
    projectId: string,
): Promise<{ success: boolean; branches?: string[]; error?: string }> {
    try {
        const { project } = await requireProjectOwner(projectId);
        if (!project.githubRepoUrl) {
            return { success: false, error: "No GitHub repository connected." };
        }

        const simpleGit = (await import("simple-git")).default;
        const git = simpleGit();
        const raw = await git.listRemote(["--heads", project.githubRepoUrl]);

        const branches = raw
            .split("\n")
            .map((line) => {
                const match = line.match(/refs\/heads\/(.+)$/);
                return match ? match[1] : null;
            })
            .filter((b): b is string => b !== null);

        return { success: true, branches };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}

export async function getGitSyncHistory(
    projectId: string,
    limit: number = 20,
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const [project] = await db
        .select({ ownerId: projects.ownerId, visibility: projects.visibility })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    if (!project) throw new Error("Project not found");
    const isPublic = project.visibility === "public";
    if (project.ownerId !== user.id && !isPublic) throw new Error("Forbidden");

    const events = await db
        .select({
            id: projectNodeEvents.id,
            type: projectNodeEvents.type,
            actorId: projectNodeEvents.actorId,
            metadata: projectNodeEvents.metadata,
            createdAt: projectNodeEvents.createdAt,
        })
        .from(projectNodeEvents)
        .where(
            and(
                eq(projectNodeEvents.projectId, projectId),
                like(projectNodeEvents.type, "git_%"),
            ),
        )
        .orderBy(desc(projectNodeEvents.createdAt))
        .limit(Math.min(limit, 50));

    return events;
}
