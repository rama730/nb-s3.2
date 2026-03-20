import { cache } from "react";
import { db } from "@/lib/db";
import { connections, profiles } from "@/lib/db/schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  derivePrivacyRelationshipState,
  type ConnectionPrivacySetting,
  type MessagePrivacySetting,
  type PrivacyConnectionRow,
  type PrivacyRelationshipState,
  type ProfileVisibilitySetting,
} from "@/lib/privacy/relationship-state";

type ConnectionRow = PrivacyConnectionRow;

const DEFAULT_VISIBILITY: ProfileVisibilitySetting = "public";
const DEFAULT_MESSAGE_PRIVACY: MessagePrivacySetting = "connections";
const DEFAULT_CONNECTION_PRIVACY: ConnectionPrivacySetting = "everyone";

const getAcceptedPeerIds = cache(async (viewerId: string) => {
  const viewerPeers = await db
    .select({
      peerId: sql<string>`CASE
        WHEN ${connections.requesterId} = ${viewerId} THEN ${connections.addresseeId}
        ELSE ${connections.requesterId}
      END`,
    })
    .from(connections)
    .where(
      and(
        eq(connections.status, "accepted"),
        or(eq(connections.requesterId, viewerId), eq(connections.addresseeId, viewerId)),
      ),
    );

  return Array.from(new Set(viewerPeers.map((row) => row.peerId).filter(Boolean)));
});

async function countMutualAcceptedConnections(viewerId: string, targetUserId: string) {
  const peerIds = await getAcceptedPeerIds(viewerId);
  if (peerIds.length === 0) return 0;

  const [result] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(connections)
    .where(
      and(
        eq(connections.status, "accepted"),
        or(eq(connections.requesterId, targetUserId), eq(connections.addresseeId, targetUserId)),
        or(
          and(eq(connections.requesterId, targetUserId), inArray(connections.addresseeId, peerIds)),
          and(eq(connections.addresseeId, targetUserId), inArray(connections.requesterId, peerIds)),
        ),
      ),
    );

  return Number(result?.count || 0);
}

async function countMutualAcceptedConnectionsBatch(viewerId: string, targetUserIds: string[]) {
  const normalizedTargetIds = Array.from(new Set(targetUserIds.filter((value) => value && value !== viewerId)));
  if (normalizedTargetIds.length === 0) return new Map<string, number>();

  const peerIds = await getAcceptedPeerIds(viewerId);
  if (peerIds.length === 0) return new Map();

  const rows = await db
    .select({
      requesterId: connections.requesterId,
      addresseeId: connections.addresseeId,
    })
    .from(connections)
    .where(
      and(
        eq(connections.status, "accepted"),
        or(
          inArray(connections.requesterId, normalizedTargetIds),
          inArray(connections.addresseeId, normalizedTargetIds),
        ),
        or(
          and(inArray(connections.requesterId, normalizedTargetIds), inArray(connections.addresseeId, peerIds)),
          and(inArray(connections.addresseeId, normalizedTargetIds), inArray(connections.requesterId, peerIds)),
        ),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of rows) {
    const targetUserId = normalizedTargetIds.includes(row.requesterId) ? row.requesterId : row.addresseeId;
    counts.set(targetUserId, (counts.get(targetUserId) ?? 0) + 1);
  }

  return counts;
}

export async function resolvePrivacyRelationship(
  viewerId: string | null,
  targetUserId: string,
): Promise<PrivacyRelationshipState | null> {
  const startedAt = Date.now();
  const [targetProfile] = await db
    .select({
      id: profiles.id,
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(eq(profiles.id, targetUserId))
    .limit(1);

  if (!targetProfile) return null;

  const latestConnection =
    viewerId && viewerId !== targetUserId
      ? await db.query.connections.findFirst({
          columns: {
            id: true,
            requesterId: true,
            addresseeId: true,
            status: true,
            blockedBy: true,
          },
          where: or(
            and(eq(connections.requesterId, viewerId), eq(connections.addresseeId, targetUserId)),
            and(eq(connections.requesterId, targetUserId), eq(connections.addresseeId, viewerId)),
          ),
          orderBy: [desc(connections.updatedAt), desc(connections.id)],
        })
      : null;

  const needsMutualResolution =
    !!viewerId &&
    viewerId !== targetUserId &&
    !latestConnection &&
    (targetProfile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY) === "mutuals_only";
  const mutualAcceptedCount =
    needsMutualResolution && viewerId
      ? await countMutualAcceptedConnections(viewerId, targetUserId)
      : 0;

  const result = derivePrivacyRelationshipState({
    viewerId,
    targetUserId,
    profileVisibility: targetProfile.visibility ?? DEFAULT_VISIBILITY,
    messagePrivacy: targetProfile.messagePrivacy ?? DEFAULT_MESSAGE_PRIVACY,
    connectionPrivacy: targetProfile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY,
    latestConnection,
    mutualAcceptedCount,
  });
  logger.metric("privacy.relationship.resolve", {
    mode: "single",
    viewerId: viewerId ?? "anon",
    targetUserId,
    durationMs: Date.now() - startedAt,
    visibilityReason: result.visibilityReason,
  });
  return result;
}

export async function resolvePrivacyRelationships(
  viewerId: string | null,
  targetUserIds: string[],
): Promise<Map<string, PrivacyRelationshipState>> {
  const startedAt = Date.now();
  const uniqueTargetIds = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (uniqueTargetIds.length === 0) return new Map();

  const targetProfiles = await db
    .select({
      id: profiles.id,
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(inArray(profiles.id, uniqueTargetIds));

  const profileById = new Map(targetProfiles.map((profile) => [profile.id, profile]));

  const latestConnections = viewerId
    ? await db
        .select({
          id: connections.id,
          requesterId: connections.requesterId,
          addresseeId: connections.addresseeId,
          status: connections.status,
          blockedBy: connections.blockedBy,
          updatedAt: connections.updatedAt,
        })
        .from(connections)
        .where(
          or(
            and(eq(connections.requesterId, viewerId), inArray(connections.addresseeId, uniqueTargetIds)),
            and(eq(connections.addresseeId, viewerId), inArray(connections.requesterId, uniqueTargetIds)),
          ),
        )
        .orderBy(desc(connections.updatedAt), desc(connections.id))
    : [];

  const latestConnectionByTarget = new Map<string, ConnectionRow>();
  for (const row of latestConnections) {
    const otherUserId = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
    if (!latestConnectionByTarget.has(otherUserId)) {
      latestConnectionByTarget.set(otherUserId, row);
    }
  }

  const needsMutualResolutionIds =
    viewerId
      ? uniqueTargetIds.filter((targetUserId) => {
          const profile = profileById.get(targetUserId);
          const latestConnection = latestConnectionByTarget.get(targetUserId) ?? null;
          return (
            !!profile &&
            viewerId !== targetUserId &&
            !latestConnection &&
            (profile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY) === "mutuals_only"
          );
        })
      : [];

  const mutualAcceptedCountByTarget =
    viewerId && needsMutualResolutionIds.length > 0
      ? await countMutualAcceptedConnectionsBatch(viewerId, needsMutualResolutionIds)
      : new Map<string, number>();

  const results = new Map<string, PrivacyRelationshipState>();
  for (const targetUserId of uniqueTargetIds) {
    const profile = profileById.get(targetUserId);
    if (!profile) continue;
    const latestConnection = latestConnectionByTarget.get(targetUserId) ?? null;
    const mutualAcceptedCount = mutualAcceptedCountByTarget.get(targetUserId) ?? 0;

    results.set(
      targetUserId,
      derivePrivacyRelationshipState({
        viewerId,
        targetUserId,
        profileVisibility: profile.visibility ?? DEFAULT_VISIBILITY,
        messagePrivacy: profile.messagePrivacy ?? DEFAULT_MESSAGE_PRIVACY,
        connectionPrivacy: profile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY,
        latestConnection,
        mutualAcceptedCount,
      }),
    );
  }

  logger.metric("privacy.relationship.resolve", {
    mode: "batch",
    viewerId: viewerId ?? "anon",
    targetCount: uniqueTargetIds.length,
    mutualResolutionCount: needsMutualResolutionIds.length,
    durationMs: Date.now() - startedAt,
  });
  return results;
}
