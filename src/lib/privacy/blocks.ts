import { db } from "@/lib/db";
import {
  clearBlockedRelationshipState,
  replaceRelationshipWithBlockedState,
} from "@/lib/privacy/relationship-transition";

export async function blockUser(blockerId: string, blockedUserId: string) {
  const now = new Date();
  return db.transaction((tx) => replaceRelationshipWithBlockedState(tx, blockerId, blockedUserId, now));
}

export async function unblockUser(blockerId: string, blockedUserId: string) {
  await db.transaction((tx) => clearBlockedRelationshipState(tx, blockerId, blockedUserId));
}
