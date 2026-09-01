import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubSyncConnections,
  githubSyncRuns,
  projects,
} from "@/lib/db/schema";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { normalizeGithubRepoUrl } from "@/lib/github/repo-validation";

// A webhook is a change notification, never permission to overwrite a workspace.
export async function POST(request: NextRequest) {
  const limited = await enforceRouteLimit(
    request,
    "api:v1:webhooks:github",
    120,
    60,
  );
  if (limited) return limited;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret)
    return jsonError("Webhooks are not configured", 503, "UNAVAILABLE");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (!reader) return jsonError("Missing body", 400, "BAD_REQUEST");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 5 * 1024 * 1024) {
        await reader.cancel();
        return jsonError("Payload too large", 413, "BAD_REQUEST");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks);
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    signatureBytes.length !== expectedBytes.length ||
    !timingSafeEqual(signatureBytes, expectedBytes)
  )
    return jsonError("Invalid signature", 401, "UNAUTHORIZED");
  const event = request.headers.get("x-github-event");
  if (event !== "push" && event !== "pull_request")
    return jsonSuccess({ skipped: true });
  let payload: {
    repository?: { id?: number; html_url?: string };
    installation?: { id?: number };
    ref?: string;
    after?: string;
    action?: string;
    pull_request?: {
      number?: number;
      merged?: boolean;
      base?: { ref?: string };
      head?: { sha?: string };
    };
  };
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return jsonError("Invalid JSON", 400, "BAD_REQUEST");
  }
  const repositoryId = payload.repository?.id;
  const installationId = payload.installation?.id;
  if (event === "pull_request" && payload.action !== "closed")
    return jsonSuccess({ skipped: true });
  const branch =
    event === "pull_request"
      ? payload.pull_request?.base?.ref
      : typeof payload.ref === "string" && payload.ref.startsWith("refs/heads/")
        ? payload.ref.slice(11)
        : null;
  const repository = normalizeGithubRepoUrl(payload.repository?.html_url || "");
  if (
    !Number.isSafeInteger(repositoryId) ||
    !repository ||
    !branch ||
    (event === "push"
      ? !/^[a-f0-9]{40}$/.test(payload.after || "")
      : !Number.isSafeInteger(payload.pull_request?.number) ||
        !/^[a-f0-9]{40}$/.test(payload.pull_request?.head?.sha || ""))
  )
    return jsonError("Invalid repository event", 400, "BAD_REQUEST");
  try {
    const connections = await db
      .select({ connection: githubSyncConnections })
      .from(githubSyncConnections)
      .innerJoin(
        projects,
        and(
          eq(projects.id, githubSyncConnections.projectId),
          isNull(projects.deletedAt),
        ),
      )
      .where(
        and(
          eq(githubSyncConnections.repositoryId, repositoryId!),
          eq(githubSyncConnections.branch, branch),
        ),
      );
    let notified = 0;
    for (const { connection } of connections) {
      if (connection.repository.toLowerCase() !== repository.toLowerCase())
        continue;
      if (
        connection.installationId !== null &&
        connection.installationId !== installationId
      )
        continue;
      if (event === "pull_request") {
        const pr = payload.pull_request!;
        await db
          .update(githubSyncRuns)
          .set({
            result: sql`${githubSyncRuns.result} || jsonb_build_object('merged',${pr.merged === true}::boolean)`,
            stage:
              pr.merged === true
                ? "Published — pull request merged"
                : "Published — pull request closed without merge",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(githubSyncRuns.projectId, connection.projectId),
              eq(githubSyncRuns.status, "completed"),
              sql`${githubSyncRuns.manifest}->>'repositoryId'=${String(repositoryId)}`,
              sql`${githubSyncRuns.result}->>'pullRequestNumber'=${String(pr.number)}`,
              sql`${githubSyncRuns.result}->>'commitSha'=${pr.head!.sha!}`,
            ),
          );
        notified++;
        continue;
      }
      // Idempotent durable notification. No pre-dispatch cache claim that can lose a delivery.
      await db
        .update(githubSyncConnections)
        .set({ incomingSha: payload.after!, updatedAt: new Date() })
        .where(
          and(
            eq(githubSyncConnections.projectId, connection.projectId),
            eq(githubSyncConnections.version, connection.version),
          ),
        );
      notified++;
    }
    return jsonSuccess({ notified, requiresReview: true });
  } catch {
    return jsonError(
      "Unable to record notification; retry delivery",
      503,
      "UNAVAILABLE",
    );
  }
}
