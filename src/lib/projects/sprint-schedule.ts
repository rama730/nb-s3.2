import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectSprintEvents, projectSprints } from "@/lib/db/schema";

/** Starts due planning sprints. Safe to call from a cron or a recovery read. */
export async function startDueSprints(
  now = new Date(),
  limit = 100,
  projectId?: string,
) {
  const due = await db
    .select({ id: projectSprints.id, projectId: projectSprints.projectId })
    .from(projectSprints)
    .where(
      and(
        eq(projectSprints.status, "planning"),
        lte(projectSprints.startDate, now),
        ...(projectId ? [eq(projectSprints.projectId, projectId)] : []),
      ),
    )
    .orderBy(asc(projectSprints.startDate), asc(projectSprints.id))
    .limit(limit);

  let started = 0;
  for (const candidate of due) {
    const didStart = await db.transaction(async (tx) => {
      const active = await tx.query.projectSprints.findFirst({
        where: and(
          eq(projectSprints.projectId, candidate.projectId),
          eq(projectSprints.status, "active"),
        ),
        columns: { id: true },
      });
      if (active) return false;

      const [updated] = await tx
        .update(projectSprints)
        .set({ status: "active", startedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, candidate.id),
            eq(projectSprints.status, "planning"),
            lte(projectSprints.startDate, now),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated) return false;

      await tx.insert(projectSprintEvents).values({
        projectId: candidate.projectId,
        sprintId: candidate.id,
        actorId: null,
        eventType: "started",
        payload: { source: "schedule" },
        createdAt: now,
      });
      return true;
    });
    if (didStart) started += 1;
  }
  return { scanned: due.length, started };
}
