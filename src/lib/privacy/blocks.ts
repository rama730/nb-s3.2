import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
import { clearBlockedRelationshipState, replaceRelationshipWithBlockedState } from "@/lib/privacy/relationship-transition";

export async function setUserBlocked(input: {
  blockerId: string;
  targetUserId: string;
  blocked: boolean;
  request: Request;
}) {
  if (input.blockerId === input.targetUserId) throw new Error("cannot block self");
  const [target] = await db.select({ id: profiles.id, username: profiles.username }).from(profiles).where(eq(profiles.id, input.targetUserId)).limit(1);
  if (!target) return null;

  await db.transaction(async (tx) => {
    if (input.blocked) {
      await replaceRelationshipWithBlockedState(tx, input.blockerId, input.targetUserId, new Date());
    } else {
      await clearBlockedRelationshipState(tx, input.blockerId, input.targetUserId);
    }
    await recordPrivacyEvent({
      executor: tx,
      userId: input.blockerId,
      eventType: input.blocked ? "account_blocked" : "account_unblocked",
      request: input.request,
      metadata: { targetUserId: input.targetUserId, targetUsername: target.username ?? null },
    });
  });
  return target;
}
