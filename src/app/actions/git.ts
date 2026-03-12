"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { projects, projectNodes, projectNodeEvents } from "@/lib/db/schema";
import { eq, and, isNull, gt, like, desc } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { inngest } from "@/inngest/client";
import { randomUUID } from "crypto";
import { parseGithubRepo } from "@/lib/github/repo-preview";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { normalizeGithubBranch, normalizeGithubRepoUrl } from "@/lib/github/repo-validation";

const REQUEST_TIMEOUT_MS = (() => {
    const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
    return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();

function createTimeoutSignal(timeoutMs: number = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("GitHub request timed out")), timeoutMs);
    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timer),
    };
}

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
            importSource: projects.importSource,
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

        const normalizedUrl = normalizeGithubRepoUrl(repoUrl || "");
        if (!normalizedUrl) {
            return { success: false, error: "Invalid GitHub repository URL." };
        }

        const resolvedBranch = normalizeGithubBranch(branch || "main");
        if (!resolvedBranch) {
            return { success: false, error: "Invalid GitHub branch name." };
        }

        await db
            .update(projects)
            .set({
                githubRepoUrl: normalizedUrl,
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
        const parsed = parseGithubRepo(project.githubRepoUrl);
        if (!parsed) {
            return { success: false, error: "Invalid GitHub repository URL." };
        }

        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const sourceMetadata = ((project.importSource as Record<string, unknown> | null)?.metadata || {}) as Record<string, unknown>;
        const preferredInstallationIdRaw = sourceMetadata.githubInstallationId;
        const preferredInstallationId =
            typeof preferredInstallationIdRaw === "number" || typeof preferredInstallationIdRaw === "string"
                ? preferredInstallationIdRaw
                : null;

        const access = await resolveGithubRepoAccess({
            repoUrl: project.githubRepoUrl,
            preferredInstallationId,
            oauthToken: session?.provider_token || null,
            sealedImportToken: sourceMetadata.importAuth,
        });
        const timeout = createTimeoutSignal();
        try {
            const allPayload: Array<{ name?: string }> = [];
            let page = 1;

            while (true) {
                const response = await fetch(
                    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100&page=${page}`,
                    {
                        method: "GET",
                        headers: {
                            Accept: "application/vnd.github+json",
                            ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
                        },
                        signal: timeout.signal,
                    },
                );

                if (!response.ok) {
                    return { success: false, error: `Failed to list branches (${response.status})` };
                }

                const rawPayload = await response.text();
                let payload: Array<{ name?: string }>;
                try {
                    payload = JSON.parse(rawPayload) as Array<{ name?: string }>;
                } catch (parseError) {
                    const responsePreview = rawPayload.slice(0, 300);
                    console.error("[getGitBranches] invalid GitHub branches JSON response", {
                        status: response.status,
                        page,
                        error: parseError instanceof Error ? parseError.message : String(parseError),
                        responsePreview,
                    });
                    return {
                        success: false,
                        error: `Invalid GitHub branches response JSON (${response.status})${responsePreview ? `: ${responsePreview}` : ""}`,
                    };
                }

                const pagePayload = Array.isArray(payload) ? payload : [];
                if (pagePayload.length === 0) break;
                allPayload.push(...pagePayload);

                if (pagePayload.length < 100) break;
                page += 1;
            }

            const branches = Array.from(new Set(allPayload
                .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
                .filter((name) => name.length > 0)))
                .sort((a, b) => a.localeCompare(b));

            return { success: true, branches };
        } finally {
            timeout.cleanup();
        }
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
