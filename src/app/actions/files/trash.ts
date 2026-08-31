"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  assertProjectManageFilesAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import {
  finishPermanentDelete,
  inspectPermanentDelete,
} from "@/lib/files/permanent-delete";
import { UUID_RE } from "./_constants";

function fingerprint(
  plan: NonNullable<Awaited<ReturnType<typeof inspectPermanentDelete>>>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        nodes: plan.nodes
          .map((n) => [n.id, n.name, n.deletedAt, n.currentVersion])
          .sort(),
        keys: [...plan.keys].sort(),
        links: plan.taskLinks,
        docs: plan.documentLinks,
      }),
    )
    .digest("hex");
}
async function actor(projectId: string, nodeId: string) {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(nodeId))
    throw new Error("Invalid file");
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { allowed } = await consumeRateLimit(`files:purge:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many requests. Try again shortly.");
  return user;
}

export async function getPermanentDeleteImpact(
  projectId: string,
  nodeId: string,
) {
  const user = await actor(projectId, nodeId);
  return db.transaction(async (tx) => {
    await assertProjectManageFilesAccessTx(tx, projectId, user.id);
    const plan = await inspectPermanentDelete(tx, projectId, nodeId);
    if (!plan) throw new Error("This item has already been deleted.");
    return {
      name: plan.nodes.find((n) => n.id === nodeId)!.name,
      items: plan.nodes.length,
      versions: plan.versions,
      taskLinks: plan.taskLinks,
      documentLinks: plan.documentLinks,
      fingerprint: fingerprint(plan),
    };
  });
}

export async function permanentlyDeleteTrashedNode(
  projectId: string,
  nodeId: string,
  expectedFingerprint: string,
) {
  const user = await actor(projectId, nodeId);
  await db.transaction(async (tx) => {
    await assertProjectManageFilesAccessTx(tx, projectId, user.id);
    const root = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.id, nodeId),
      ),
    });
    if (!root) return; // Idempotent retry after a successful delete.
    const plan = await inspectPermanentDelete(tx, projectId, nodeId);
    if (!plan) return;
    if (root.metadata?.permanentDeleteRoot === nodeId) return;
    if (fingerprint(plan) !== expectedFingerprint)
      throw new Error(
        "The items changed. Close this dialog and review the deletion again.",
      );
    if (plan.nodes.some((node) => node.metadata?.permanentDeleteRoot))
      throw new Error(
        "A deletion is already pending in this folder. Wait for it to finish.",
      );
    await tx
      .update(projectNodes)
      .set({
        metadata: sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ permanentDeleteRoot: nodeId, permanentDeleteActor: user.id, permanentDeleteRequestedAt: new Date().toISOString() })}::jsonb`,
      })
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          inArray(projectNodes.id, plan.ids),
        ),
      );
    await recordNodeEvent(
      projectId,
      user.id,
      nodeId,
      "permanent_delete_requested",
      { items: plan.ids.length },
      tx,
    );
  });
  try {
    return {
      status: "deleted" as const,
      ...(await finishPermanentDelete(projectId, nodeId)),
    };
  } catch {
    return { status: "pending" as const, deletedIds: [] as string[] };
  }
}
