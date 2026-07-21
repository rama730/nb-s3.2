import { and, count, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { connections, profiles } from "@/lib/db/schema";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
import type {
  ConnectionPrivacySetting,
  MessagePrivacySetting,
  ProfileVisibilitySetting,
} from "@/lib/privacy/relationship-state";

import type { PrivacyBlockedAccount, PrivacySettingsState } from "@/lib/types/settingsTypes";

type PrivacySettingsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PROFILE_NOT_FOUND_ERROR_MESSAGE = "Profile not found";

function createProfileNotFoundError() {
  return new Error(PROFILE_NOT_FOUND_ERROR_MESSAGE);
}

export function isProfileNotFoundError(error: unknown) {
  return error instanceof Error && error.message === PROFILE_NOT_FOUND_ERROR_MESSAGE;
}

async function requireProfilePrivacySettingsRow(
  tx: PrivacySettingsTransaction,
  userId: string,
) {
  const [profile] = await tx
    .select({
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1)
    .for("update");

  if (!profile) {
    throw createProfileNotFoundError();
  }

  return {
    visibility: (profile.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile.messagePrivacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting,
  };
}

type PrivacyUpdateInput =
  | { kind: "profileVisibility"; nextValue: ProfileVisibilitySetting }
  | { kind: "messagePrivacy"; nextValue: MessagePrivacySetting }
  | { kind: "connectionPrivacy"; nextValue: ConnectionPrivacySetting };

export async function updatePrivacySetting(input: PrivacyUpdateInput & {
  userId: string;
  request: Request;
}) {
  await db.transaction(async (tx) => {
    const current = await requireProfilePrivacySettingsRow(tx, input.userId);
    const update = input.kind === "profileVisibility"
      ? { visibility: input.nextValue }
      : input.kind === "messagePrivacy"
        ? { messagePrivacy: input.nextValue }
        : { connectionPrivacy: input.nextValue };
    const rows = await tx
      .update(profiles)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(profiles.id, input.userId))
      .returning({ id: profiles.id });
    if (rows.length !== 1) throw createProfileNotFoundError();

    const event = input.kind === "profileVisibility"
      ? { eventType: "profile_visibility_changed" as const, previousValue: { visibility: current.visibility }, nextValue: { visibility: input.nextValue } }
      : input.kind === "messagePrivacy"
        ? { eventType: "message_privacy_changed" as const, previousValue: { messagePrivacy: current.messagePrivacy }, nextValue: { messagePrivacy: input.nextValue } }
        : { eventType: "connection_privacy_changed" as const, previousValue: { connectionPrivacy: current.connectionPrivacy }, nextValue: { connectionPrivacy: input.nextValue } };

    await recordPrivacyEvent({
      executor: tx,
      userId: input.userId,
      request: input.request,
      ...event,
    });
  });
}

export async function getPrivacySettingsPayload(userId: string): Promise<PrivacySettingsState> {
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
        or(
          eq(connections.requesterId, userId),
          eq(connections.addresseeId, userId),
        ),
      ),
    );

  return {
    profileVisibility: (profile?.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile?.messagePrivacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile?.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting,
    blockedCount: Number(blockedAggregate?.count ?? 0),
  };
}

export async function listBlockedAccounts(userId: string): Promise<PrivacyBlockedAccount[]> {
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
    .innerJoin(
      profiles,
      or(
        and(
          eq(connections.requesterId, userId),
          eq(profiles.id, connections.addresseeId),
        ),
        and(
          eq(connections.addresseeId, userId),
          eq(profiles.id, connections.requesterId),
        ),
      ),
    )
    .where(
      and(
        eq(connections.status, "blocked"),
        eq(connections.blockedBy, userId),
        or(
          eq(connections.requesterId, userId),
          eq(connections.addresseeId, userId),
        ),
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
