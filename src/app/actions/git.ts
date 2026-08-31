"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { inngest } from "@/inngest/client";
import { randomUUID } from "crypto";
import { fetchRepoMeta, parseGithubRepo } from "@/lib/github/repo-preview";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import {
    GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE,
    GITHUB_CONNECTION_REQUIRED_MESSAGE,
    resolveGithubExternalAccountHealth,
} from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { createSignedJobRequestToken } from "@/lib/security/job-request";

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

/** Safe connection summary: never expose import credentials to the browser. */
export async function getProjectGitConnection(projectId: string) {
    const { project } = await requireProjectOwner(projectId);
    return { repository: project.githubRepoUrl, branch: project.githubDefaultBranch, lastSyncAt: project.githubLastSyncAt };
}

async function resolveGitActionAccess(
    user: Awaited<ReturnType<typeof requireProjectOwner>>["user"],
    project: Awaited<ReturnType<typeof requireProjectOwner>>["project"],
) {
    if (!project.githubRepoUrl) {
        return null;
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const metadata = ((project.importSource as Record<string, unknown> | null)?.metadata || {}) as Record<string, unknown>;
    const preferredInstallationIdRaw = metadata.githubInstallationId;
    const preferredInstallationId =
        typeof preferredInstallationIdRaw === "number" || typeof preferredInstallationIdRaw === "string"
            ? preferredInstallationIdRaw
            : null;
    const connection = buildGithubAccountConnectionState(user);
    const [health, access] = await Promise.all([
        resolveGithubExternalAccountHealth({
            linked: connection.linked,
            username: connection.username,
        }),
        resolveGithubRepoAccess({
            repoUrl: project.githubRepoUrl,
            preferredInstallationId,
            oauthToken: session?.provider_token || null,
            sealedImportToken: metadata.importAuth,
        }),
    ]);

    return { access, connection, health };
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

        const githubAccess = await resolveGitActionAccess(user, project);
        if (!githubAccess) {
            return { success: false, error: "No GitHub repository connected." };
        }
        if (githubAccess.access.source !== "app") {
            if (githubAccess.health.state === "unavailable") {
                return { success: false, error: GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE };
            }
            if (!githubAccess.connection.linked || !githubAccess.access.token) {
                return { success: false, error: GITHUB_CONNECTION_REQUIRED_MESSAGE };
            }
        }

        const rl = await consumeRateLimit(`git:push:${user.id}`, 10, 3600);
        if (!rl.allowed) {
            return { success: false, error: "Rate limit exceeded. Try again later." };
        }

        const jobId = randomUUID();
        await inngest.send({
            name: "git/push",
            data: {
                projectId,
                commitMessage,
                userId: user.id,
                jobSignature: createSignedJobRequestToken({
                    kind: "git/push",
                    actorId: user.id,
                    subjectId: projectId,
                }),
            },
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

        const githubAccess = await resolveGitActionAccess(user, project);
        if (!githubAccess) {
            return { success: false, error: "No GitHub repository connected." };
        }

        let useAnonymousAccess = false;
        if (
            githubAccess.access.source !== "app" &&
            (githubAccess.health.state === "unavailable" || !githubAccess.connection.linked)
        ) {
            const parsed = parseGithubRepo(project.githubRepoUrl);
            if (!parsed) {
                return { success: false, error: "Invalid GitHub repository URL." };
            }
            try {
                await fetchRepoMeta(parsed);
                useAnonymousAccess = true;
            } catch {
                return {
                    success: false,
                    error: githubAccess.health.state === "unavailable"
                        ? GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE
                        : GITHUB_CONNECTION_REQUIRED_MESSAGE,
                };
            }
        }

        const rl = await consumeRateLimit(`git:pull:${user.id}`, 10, 3600);
        if (!rl.allowed) {
            return { success: false, error: "Rate limit exceeded. Try again later." };
        }

        const jobId = randomUUID();
        await inngest.send({
            name: "git/pull",
            data: {
                projectId,
                userId: user.id,
                anonymous: useAnonymousAccess,
                jobSignature: createSignedJobRequestToken({
                    kind: "git/pull",
                    actorId: user.id,
                    subjectId: projectId,
                }),
            },
            id: jobId,
        });

        return { success: true, jobId };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: msg };
    }
}
