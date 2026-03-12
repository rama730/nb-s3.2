import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, inArray, isNull } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { normalizeGithubRepoUrl } from "@/lib/github/repo-validation";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const MIN_SYNC_INTERVAL_MS = 30_000;

function verifySignature(payload: string, signature: string | null): boolean {
    if (!WEBHOOK_SECRET || !signature) return false;

    const expected = `sha256=${createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex")}`;

    try {
        return timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signature),
        );
    } catch {
        return false;
    }
}

function getRequestId(request: Request) {
    const fromHeader = request.headers.get("x-request-id")?.trim();
    return fromHeader && fromHeader.length > 0 ? fromHeader : crypto.randomUUID();
}

function getRequestPath(request: Request) {
    try {
        return new URL(request.url).pathname;
    } catch {
        return "/api/v1/webhooks/github";
    }
}

function logWebhookRequest(
    request: Request,
    params: {
        requestId: string;
        startedAt: number;
        status: number;
        success: boolean;
        errorCode?: string;
    },
) {
    logger.info("api.v1.request", {
        requestId: params.requestId,
        route: getRequestPath(request),
        action: "webhooks.github.post",
        durationMs: Date.now() - params.startedAt,
        status: params.status,
        success: params.success,
        errorCode: params.errorCode ?? null,
    });
}

export async function POST(request: NextRequest) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!verifySignature(body, signature)) {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 401,
            success: false,
            errorCode: "UNAUTHORIZED",
        });
        return jsonError("Invalid signature", 401, "UNAUTHORIZED");
    }

    const eventType = request.headers.get("x-github-event");
    if (eventType !== "push") {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
        });
        return jsonSuccess({ skipped: true });
    }

    let payload: {
        repository?: { clone_url?: string; html_url?: string };
        ref?: string;
        after?: string;
    };
    try {
        payload = JSON.parse(body);
    } catch {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            errorCode: "BAD_REQUEST",
        });
        return jsonError("Invalid JSON", 400, "BAD_REQUEST");
    }

    const cloneUrl = payload.repository?.clone_url;
    const htmlUrl = payload.repository?.html_url;
    const normalizedRepoUrls = new Set<string>();
    const normalizedHtmlUrl = normalizeGithubRepoUrl(htmlUrl || "");
    const normalizedCloneUrl = normalizeGithubRepoUrl(cloneUrl || "");
    if (normalizedHtmlUrl) normalizedRepoUrls.add(normalizedHtmlUrl);
    if (normalizedCloneUrl) normalizedRepoUrls.add(normalizedCloneUrl);

    if (normalizedRepoUrls.size === 0) {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            errorCode: "BAD_REQUEST",
        });
        return jsonError("Missing repository URL", 400, "BAD_REQUEST");
    }

    const deliveryId = request.headers.get("x-github-delivery")?.trim() || null;
    const pushedBranch = typeof payload.ref === "string" && payload.ref.startsWith("refs/heads/")
        ? payload.ref.slice("refs/heads/".length)
        : null;
    const afterSha = typeof payload.after === "string" ? payload.after : null;

    const candidateProjects = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            githubDefaultBranch: projects.githubDefaultBranch,
            githubLastSyncAt: projects.githubLastSyncAt,
        })
        .from(projects)
        .where(
            and(
                inArray(projects.githubRepoUrl, Array.from(normalizedRepoUrls)),
                isNull(projects.deletedAt),
            ),
        );

    if (candidateProjects.length === 0) {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
        });
        return jsonSuccess({ skipped: true, reason: "no matching project" });
    }

    const nowMs = Date.now();
    const sendJobs: Promise<unknown>[] = [];
    let skippedBranchMismatch = 0;
    let skippedThrottled = 0;

    for (const project of candidateProjects) {
        const defaultBranch = (project.githubDefaultBranch || "main").trim() || "main";
        if (pushedBranch && defaultBranch !== pushedBranch) {
            skippedBranchMismatch += 1;
            continue;
        }

        if (project.githubLastSyncAt && nowMs - project.githubLastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) {
            skippedThrottled += 1;
            continue;
        }

        const eventId = deliveryId
            ? `git-pull:${project.id}:${deliveryId}`
            : `git-pull:${project.id}:${afterSha || nowMs}`;

        sendJobs.push(
            inngest.send({
                name: "git/pull",
                id: eventId,
                data: {
                    projectId: project.id,
                    userId: project.ownerId,
                    branch: pushedBranch,
                    deliveryId,
                    afterSha,
                    source: "webhook",
                },
            }),
        );
    }

    const sendResults = await Promise.allSettled(sendJobs);
    const triggered = sendResults.filter((job) => job.status === "fulfilled").length;
    const enqueueFailures = sendResults.length - triggered;

    logger.metric("github.webhook.push.fanout", {
        requestId,
        matchedProjects: candidateProjects.length,
        triggered,
        skippedBranchMismatch,
        skippedThrottled,
        enqueueFailures,
        deliveryId,
        branch: pushedBranch,
    });

    logWebhookRequest(request, {
        requestId,
        startedAt,
        status: 200,
        success: true,
    });
    return jsonSuccess({
        matched: candidateProjects.length,
        triggered,
        skipped: {
            branchMismatch: skippedBranchMismatch,
            throttled: skippedThrottled,
        },
        enqueueFailures,
    });
}
