import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema/domains/files";
import { tasks } from "@/lib/db/schema/domains/projects";

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
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(drawerId);
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
