import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectNodes, tasks } from "@/lib/db/schema";
import { isLooseUuid } from "@/lib/validations/uuid";

export async function readProjectFileMetadataTitle(
  projectId: string,
  fileId: string,
): Promise<string | null> {
  const [node] = await db
    .select({ name: projectNodes.name })
    .from(projectNodes)
    .where(
      and(
        eq(projectNodes.id, fileId),
        eq(projectNodes.projectId, projectId),
        isNull(projectNodes.deletedAt),
      ),
    )
    .limit(1);
  return node?.name ?? null;
}

export function parseTaskNumberFromDrawerId(drawerId: string): number | null {
  const dashIndex = drawerId.lastIndexOf("-");
  if (dashIndex < 0) return null;
  const value = Number(drawerId.slice(dashIndex + 1));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function readProjectTaskMetadataTitle(
  projectId: string,
  drawerId: string,
): Promise<string | null> {
  const isUuid = isLooseUuid(drawerId);
  const taskNumber = isUuid ? null : parseTaskNumberFromDrawerId(drawerId);
  if (!isUuid && taskNumber === null) return null;

  const [task] = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isUuid ? eq(tasks.id, drawerId) : eq(tasks.taskNumber, taskNumber!),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  return task?.title ?? null;
}
