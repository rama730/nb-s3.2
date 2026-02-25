import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

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

export async function POST(request: NextRequest) {
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!verifySignature(body, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const eventType = request.headers.get("x-github-event");
    if (eventType !== "push") {
        return NextResponse.json({ ok: true, skipped: true });
    }

    let payload: { repository?: { clone_url?: string; html_url?: string }; after?: string };
    try {
        payload = JSON.parse(body);
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const cloneUrl = payload.repository?.clone_url;
    const htmlUrl = payload.repository?.html_url;
    if (!cloneUrl && !htmlUrl) {
        return NextResponse.json({ error: "Missing repository URL" }, { status: 400 });
    }

    const matchUrl = htmlUrl?.replace(/\/+$/, "") ?? cloneUrl?.replace(/\.git$/, "").replace(/\/+$/, "");

    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            githubLastSyncAt: projects.githubLastSyncAt,
        })
        .from(projects)
        .where(eq(projects.githubRepoUrl, matchUrl!))
        .limit(1);

    if (!project) {
        return NextResponse.json({ ok: true, skipped: true, reason: "no matching project" });
    }

    if (
        project.githubLastSyncAt &&
        Date.now() - project.githubLastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS
    ) {
        return NextResponse.json({ ok: true, skipped: true, reason: "throttled" });
    }

    await inngest.send({
        name: "git/pull",
        data: {
            projectId: project.id,
            userId: project.ownerId,
        },
    });

    return NextResponse.json({ ok: true, triggered: true });
}
