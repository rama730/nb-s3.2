import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, inArray, isNull } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { normalizeGithubRepoUrl } from "@/lib/github/repo-validation";
import { getRedisClient } from "@/lib/redis";
import { createSignedJobRequestToken } from "@/lib/security/job-request";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const MIN_SYNC_INTERVAL_MS = 30_000;
const WEBHOOK_DELIVERY_TTL_SECONDS = 86_400;

let loggedMissingSecret = false;

// SEC-H10: in production the boot-time check in `assertProductionSecurityEnv`
// already refuses to start without `GITHUB_WEBHOOK_SECRET`, so this function
// should never encounter an empty secret there. In dev/staging we still want
// to refuse (rather than fall through silently) and log once so the operator
// sees that webhooks are disabled.
function verifySignature(payload: string, signature: string | null): boolean {
    if (!WEBHOOK_SECRET) {
        if (!loggedMissingSecret) {
            loggedMissingSecret = true;
            logger.error("github.webhook.secret_missing", {
                module: "webhooks.github",
                message:
                    "GITHUB_WEBHOOK_SECRET is not configured. Refusing all webhook deliveries.",
            });
        }
        return false;
    }
    if (!signature) return false;

    const expected = `sha256=${createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex")}`;

    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signature);
    if (expectedBuf.length !== receivedBuf.length) return false;

    try {
        return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
        return false;
    }
}

function asPositiveInteger(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}

function readProjectGithubIdentity(importSource: unknown) {
    const source = importSource as {
        repoUrl?: unknown;
        metadata?: {
            githubRepoId?: unknown;
            githubInstallationId?: unknown;
        } | null;
    } | null;

    const normalizedRepoUrl = normalizeGithubRepoUrl(typeof source?.repoUrl === "string" ? source.repoUrl : "");
    return {
        repoUrl: normalizedRepoUrl,
        repoId: asPositiveInteger(source?.metadata?.githubRepoId),
        installationId: asPositiveInteger(source?.metadata?.githubInstallationId),
    };
}

async function claimGithubDeliveryId(deliveryId: string | null) {
    if (!deliveryId) return { duplicate: false, degraded: false } as const;

    const redis = getRedisClient();
    if (!redis) {
        return { duplicate: false, degraded: true } as const;
    }

    const claimed = await redis.set(`github:webhook:delivery:${deliveryId}`, "1", {
        nx: true,
        ex: WEBHOOK_DELIVERY_TTL_SECONDS,
    });

    return {
        duplicate: !claimed,
        degraded: false,
    } as const;
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
        repository?: { id?: number | string; clone_url?: string; html_url?: string };
        installation?: { id?: number | string } | null;
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
    const claimedDelivery = await claimGithubDeliveryId(deliveryId);
    if (claimedDelivery.duplicate) {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
        });
        return jsonSuccess({ skipped: true, reason: "duplicate delivery" });
    }

    const pushedBranch = typeof payload.ref === "string" && payload.ref.startsWith("refs/heads/")
        ? payload.ref.slice("refs/heads/".length)
        : null;
    const afterSha = typeof payload.after === "string" ? payload.after : null;
    const payloadRepoId = asPositiveInteger(payload.repository?.id);
    const payloadInstallationId = asPositiveInteger(payload.installation?.id);

    if (!payloadRepoId || !payloadInstallationId) {
        logWebhookRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
        });
        return jsonSuccess({ skipped: true, reason: "missing immutable repository identity" });
    }

    const candidateProjects = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            githubDefaultBranch: projects.githubDefaultBranch,
            githubLastSyncAt: projects.githubLastSyncAt,
            importSource: projects.importSource,
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
    let skippedIdentityMismatch = 0;
    let skippedBranchMismatch = 0;
    let skippedThrottled = 0;

    for (const project of candidateProjects) {
        const identity = readProjectGithubIdentity(project.importSource);
        if (
            !identity.repoUrl
            || !normalizedRepoUrls.has(identity.repoUrl)
            || identity.repoId !== payloadRepoId
            || identity.installationId !== payloadInstallationId
        ) {
            skippedIdentityMismatch += 1;
            continue;
        }

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
                    jobSignature: createSignedJobRequestToken({
                        kind: "git/pull",
                        actorId: project.ownerId,
                        subjectId: project.id,
                    }),
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
        skippedIdentityMismatch,
        skippedBranchMismatch,
        skippedThrottled,
        enqueueFailures,
        deliveryId,
        branch: pushedBranch,
        degradedDeliveryDedup: claimedDelivery.degraded,
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
            identityMismatch: skippedIdentityMismatch,
            branchMismatch: skippedBranchMismatch,
            throttled: skippedThrottled,
        },
        enqueueFailures,
    });
}
