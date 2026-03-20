export type ProfileVisibilitySetting = "public" | "connections" | "private";
export type MessagePrivacySetting = "everyone" | "connections";
export type ConnectionPrivacySetting = "everyone" | "mutuals_only" | "nobody";
export type PrivacyVisibilityReason =
  | "self"
  | "blocked"
  | "connected"
  | "public"
  | "connections_only"
  | "private";

export type PrivacyConnectionState =
  | "none"
  | "pending_outgoing"
  | "pending_incoming"
  | "connected"
  | "blocked_by_viewer"
  | "blocked_by_target";

export interface PrivacyRelationshipState {
  viewerId: string | null;
  targetUserId: string;
  isSelf: boolean;
  isConnected: boolean;
  hasPendingIncomingRequest: boolean;
  hasPendingOutgoingRequest: boolean;
  blockedByViewer: boolean;
  blockedByTarget: boolean;
  profileVisibility: ProfileVisibilitySetting;
  messagePrivacy: MessagePrivacySetting;
  connectionPrivacy: ConnectionPrivacySetting;
  canViewProfile: boolean;
  canSendConnectionRequest: boolean;
  canSendMessage: boolean;
  shouldHideFromDiscovery: boolean;
  visibilityReason: PrivacyVisibilityReason;
  connectionState: PrivacyConnectionState;
  latestConnectionId: string | null;
}

export type PrivacyConnectionRow = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "disconnected" | "blocked";
  blockedBy: string | null;
};

const DEFAULT_VISIBILITY: ProfileVisibilitySetting = "public";
const DEFAULT_MESSAGE_PRIVACY: MessagePrivacySetting = "connections";
const DEFAULT_CONNECTION_PRIVACY: ConnectionPrivacySetting = "everyone";

export function derivePrivacyRelationshipState(input: {
  viewerId: string | null;
  targetUserId: string;
  profileVisibility?: ProfileVisibilitySetting | null;
  messagePrivacy?: MessagePrivacySetting | null;
  connectionPrivacy?: ConnectionPrivacySetting | null;
  latestConnection?: PrivacyConnectionRow | null;
  mutualAcceptedCount?: number;
}): PrivacyRelationshipState {
  const viewerId = input.viewerId ?? null;
  const isSelf = !!viewerId && viewerId === input.targetUserId;
  const profileVisibility = input.profileVisibility ?? DEFAULT_VISIBILITY;
  const messagePrivacy = input.messagePrivacy ?? DEFAULT_MESSAGE_PRIVACY;
  const connectionPrivacy = input.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY;
  const latestConnection = input.latestConnection ?? null;
  const blockedByViewer =
    !!viewerId &&
    latestConnection?.status === "blocked" &&
    latestConnection.blockedBy === viewerId;
  const blockedByTarget =
    !!viewerId &&
    latestConnection?.status === "blocked" &&
    latestConnection.blockedBy === input.targetUserId;
  const isConnected = latestConnection?.status === "accepted";
  const hasPendingOutgoingRequest =
    !!viewerId &&
    latestConnection?.status === "pending" &&
    latestConnection.requesterId === viewerId;
  const hasPendingIncomingRequest =
    !!viewerId &&
    latestConnection?.status === "pending" &&
    latestConnection.requesterId === input.targetUserId;

  let canViewProfile = false;
  let visibilityReason: PrivacyVisibilityReason = "private";

  if (blockedByViewer || blockedByTarget) {
    canViewProfile = false;
    visibilityReason = "blocked";
  } else if (isSelf) {
    canViewProfile = true;
    visibilityReason = "self";
  } else if (isConnected) {
    canViewProfile = true;
    visibilityReason = "connected";
  } else if (profileVisibility === "public") {
    canViewProfile = true;
    visibilityReason = "public";
  } else if (profileVisibility === "connections") {
    canViewProfile = false;
    visibilityReason = "connections_only";
  } else {
    canViewProfile = false;
    visibilityReason = "private";
  }

  const hasMutualAcceptedConnection = (input.mutualAcceptedCount ?? 0) > 0;
  const canSendConnectionRequest =
    !isSelf &&
    !blockedByViewer &&
    !blockedByTarget &&
    !isConnected &&
    !hasPendingIncomingRequest &&
    !hasPendingOutgoingRequest &&
    (connectionPrivacy === "everyone" ||
      (connectionPrivacy === "mutuals_only" && hasMutualAcceptedConnection));

  const canSendMessage =
    !isSelf &&
    !blockedByViewer &&
    !blockedByTarget &&
    (isConnected || messagePrivacy === "everyone");

  let connectionState: PrivacyConnectionState = "none";
  if (blockedByViewer) connectionState = "blocked_by_viewer";
  else if (blockedByTarget) connectionState = "blocked_by_target";
  else if (isConnected) connectionState = "connected";
  else if (hasPendingOutgoingRequest) connectionState = "pending_outgoing";
  else if (hasPendingIncomingRequest) connectionState = "pending_incoming";

  return {
    viewerId,
    targetUserId: input.targetUserId,
    isSelf,
    isConnected,
    hasPendingIncomingRequest,
    hasPendingOutgoingRequest,
    blockedByViewer,
    blockedByTarget,
    profileVisibility,
    messagePrivacy,
    connectionPrivacy,
    canViewProfile,
    canSendConnectionRequest,
    canSendMessage,
    shouldHideFromDiscovery: blockedByViewer || blockedByTarget,
    visibilityReason,
    connectionState,
    latestConnectionId: latestConnection?.id ?? null,
  };
}
