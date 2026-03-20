import { and, eq, or } from "drizzle-orm";
import { connections } from "@/lib/db/schema";

type Tx = any;

export async function replaceRelationshipWithBlockedState(
  tx: Tx,
  blockerId: string,
  blockedUserId: string,
  now: Date,
) {
  await tx
    .delete(connections)
    .where(
      or(
        and(eq(connections.requesterId, blockerId), eq(connections.addresseeId, blockedUserId)),
        and(eq(connections.requesterId, blockedUserId), eq(connections.addresseeId, blockerId)),
      ),
    );

  const inserted = await tx
    .insert(connections)
    .values({
      requesterId: blockerId,
      addresseeId: blockedUserId,
      status: "blocked",
      blockedBy: blockerId,
      blockedAt: now,
    })
    .returning({ id: connections.id });

  return inserted[0]?.id ?? null;
}

export async function clearBlockedRelationshipState(
  tx: Tx,
  blockerId: string,
  blockedUserId: string,
) {
  await tx
    .delete(connections)
    .where(
      or(
        and(
          eq(connections.requesterId, blockerId),
          eq(connections.addresseeId, blockedUserId),
          eq(connections.status, "blocked"),
          eq(connections.blockedBy, blockerId),
        ),
        and(
          eq(connections.requesterId, blockedUserId),
          eq(connections.addresseeId, blockerId),
          eq(connections.status, "blocked"),
          eq(connections.blockedBy, blockerId),
        ),
      ),
    );
}
