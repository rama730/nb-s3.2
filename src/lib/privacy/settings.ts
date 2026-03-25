import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { connections, profiles } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
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

type PrivacySettingsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PROFILE_NOT_FOUND_ERROR_MESSAGE = "Profile not found";

function createProfileNotFoundError() {
  return new Error(PROFILE_NOT_FOUND_ERROR_MESSAGE);
}

export function isProfileNotFoundError(error: unknown) {
  return error instanceof Error && error.message === PROFILE_NOT_FOUND_ERROR_MESSAGE;
}

function getMutationAffectedRowCount(result: unknown): number {
  if (typeof result === "number" && Number.isFinite(result)) {
    return result;
  }

  if (!result || typeof result !== "object") {
    return 0;
  }

  const candidate = result as Record<string, unknown>;
  const affected =
    candidate.rowCount ??
    candidate.rowsAffected ??
    candidate.affectedRows ??
    candidate.count;

  return typeof affected === "number" && Number.isFinite(affected) ? affected : 0;
}

async function requireProfilePrivacySettingsRow(
  tx: PrivacySettingsTransaction,
  userId: string,
) {
  const rows = await tx.execute<{
    visibility: ProfileVisibilitySetting | null;
    message_privacy: MessagePrivacySetting | null;
    connection_privacy: ConnectionPrivacySetting | null;
  }>(sql`
    SELECT
      visibility,
      message_privacy,
      connection_privacy
    FROM profiles
    WHERE id = ${userId}::uuid
    FOR UPDATE
  `);
  const profile = Array.from(rows)[0] ?? null;

  if (!profile) {
    throw createProfileNotFoundError();
  }

  return {
    visibility: (profile.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile.message_privacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile.connection_privacy ?? "everyone") as ConnectionPrivacySetting,
  };
}

export async function updateMessagePrivacySetting(input: {
  userId: string;
  nextValue: MessagePrivacySetting;
  request: Request;
}) {
  const updatedAt = new Date();

  await db.transaction(async (tx) => {
    const current = await requireProfilePrivacySettingsRow(tx, input.userId);

    await tx
      .update(profiles)
      .set({
        messagePrivacy: input.nextValue,
        updatedAt,
      })
      .where(eq(profiles.id, input.userId))
      .returning({ id: profiles.id })
      .then((rows) => {
        if (rows.length !== 1) {
          throw createProfileNotFoundError();
        }
      });

    await recordPrivacyEvent({
      executor: tx,
      userId: input.userId,
      eventType: "message_privacy_changed",
      request: input.request,
      previousValue: { messagePrivacy: current.messagePrivacy },
      nextValue: { messagePrivacy: input.nextValue },
    });
  });
}

export async function updateProfileVisibilitySetting(input: {
  userId: string;
  nextValue: ProfileVisibilitySetting;
  request: Request;
}) {
  const updatedAt = new Date();
  return await db.transaction(async (tx) => {
    const current = await requireProfilePrivacySettingsRow(tx, input.userId);

    const updateResult = await tx
      .update(profiles)
      .set({
        visibility: input.nextValue,
        updatedAt,
      })
      .where(eq(profiles.id, input.userId));

    if (getMutationAffectedRowCount(updateResult) !== 1) {
      throw createProfileNotFoundError();
    }

    await recordPrivacyEvent({
      executor: tx,
      userId: input.userId,
      eventType: "profile_visibility_changed",
      request: input.request,
      previousValue: { visibility: current.visibility },
      nextValue: { visibility: input.nextValue },
    });

    return {
      previousValue: current.visibility,
      nextValue: input.nextValue,
    };
  });
}

export async function updateConnectionPrivacySetting(input: {
  userId: string;
  nextValue: ConnectionPrivacySetting;
  request: Request;
}) {
  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    const current = await requireProfilePrivacySettingsRow(tx, input.userId);

    await tx
      .update(profiles)
      .set({
        connectionPrivacy: input.nextValue,
        updatedAt,
      })
      .where(eq(profiles.id, input.userId))
      .returning({ id: profiles.id })
      .then((rows) => {
        if (rows.length !== 1) {
          throw createProfileNotFoundError();
        }
      });

    await recordPrivacyEvent({
      executor: tx,
      userId: input.userId,
      eventType: "connection_privacy_changed",
      request: input.request,
      previousValue: { connectionPrivacy: current.connectionPrivacy },
      nextValue: { connectionPrivacy: input.nextValue },
    });
  });
}

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
