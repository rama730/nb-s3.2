import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connections, profiles } from "@/lib/db/schema";
import type {
  ConnectionPrivacySetting,
  MessagePrivacySetting,
  ProfileVisibilitySetting,
} from "@/lib/privacy/relationship-state";

export type BlockedAccountEntry = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  blockedAt: string | null;
};

export type PrivacySettingsPayload = {
  profileVisibility: ProfileVisibilitySetting;
  messagePrivacy: MessagePrivacySetting;
  connectionPrivacy: ConnectionPrivacySetting;
  blockedCount: number;
};

export async function getPrivacySettingsPayload(userId: string): Promise<PrivacySettingsPayload> {
  const [profile] = await db
    .select({
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const [blockedAggregate] = await db
    .select({ count: count() })
    .from(connections)
    .where(
      and(
        eq(connections.status, "blocked"),
        eq(connections.blockedBy, userId),
        eq(connections.requesterId, userId),
      ),
    );

  return {
    profileVisibility: (profile?.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile?.messagePrivacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile?.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting,
    blockedCount: Number(blockedAggregate?.count ?? 0),
  };
}

export async function listBlockedAccounts(userId: string): Promise<BlockedAccountEntry[]> {
  const rows = await db
    .select({
      id: profiles.id,
      username: profiles.username,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      headline: profiles.headline,
      blockedAt: connections.blockedAt,
    })
    .from(connections)
    .innerJoin(profiles, eq(profiles.id, connections.addresseeId))
    .where(
      and(
        eq(connections.status, "blocked"),
        eq(connections.blockedBy, userId),
        eq(connections.requesterId, userId),
      ),
    )
    .orderBy(desc(connections.blockedAt), desc(connections.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    headline: row.headline,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
  }));
}
