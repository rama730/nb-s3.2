import type { PrivacyRelationshipState } from "@/lib/privacy/relationship-state";

type ProjectOwnerInput = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type PrivacyPresentation = {
  relationshipBadgeText: string | null;
  relationshipExplanation: string | null;
  blockedBannerText: string | null;
  canOpenProfile: boolean;
  canSendMessage: boolean;
  canSendConnectionRequest: boolean;
  ownerDisplayMode: "full" | "masked";
  ownerBadgeText: string | null;
};

export type ProjectOwnerPresentation = ProjectOwnerInput & {
  displayName: string;
  isMasked: boolean;
  canOpenProfile: boolean;
  badgeText: string | null;
};

export function buildPrivacyPresentation(
  relationship: PrivacyRelationshipState | null,
): PrivacyPresentation {
  if (!relationship) {
    return {
      relationshipBadgeText: null,
      relationshipExplanation: null,
      blockedBannerText: null,
      canOpenProfile: true,
      canSendMessage: true,
      canSendConnectionRequest: true,
      ownerDisplayMode: "full",
      ownerBadgeText: null,
    };
  }

  if (relationship.blockedByViewer) {
    return {
      relationshipBadgeText: "Blocked",
      relationshipExplanation: "You blocked this account.",
      blockedBannerText: "You blocked this account",
      canOpenProfile: false,
      canSendMessage: false,
      canSendConnectionRequest: false,
      ownerDisplayMode: "masked",
      ownerBadgeText: "Blocked",
    };
  }

  if (relationship.blockedByTarget) {
    return {
      relationshipBadgeText: "Blocked",
      relationshipExplanation: "You can no longer interact with this account.",
      blockedBannerText: "You can no longer message this account",
      canOpenProfile: false,
      canSendMessage: false,
      canSendConnectionRequest: false,
      ownerDisplayMode: "masked",
      ownerBadgeText: "Blocked",
    };
  }

  if (relationship.visibilityReason === "connections_only") {
    return {
      relationshipBadgeText: "Connections only",
      relationshipExplanation: "Only accepted connections can open the full profile.",
      blockedBannerText: null,
      canOpenProfile: false,
      canSendMessage: relationship.canSendMessage,
      canSendConnectionRequest: relationship.canSendConnectionRequest,
      ownerDisplayMode: "masked",
      ownerBadgeText: "Connections only",
    };
  }

  if (relationship.visibilityReason === "private") {
    return {
      relationshipBadgeText: "Private",
      relationshipExplanation: "Non-connections see a locked profile shell.",
      blockedBannerText: null,
      canOpenProfile: false,
      canSendMessage: relationship.canSendMessage,
      canSendConnectionRequest: relationship.canSendConnectionRequest,
      ownerDisplayMode: "masked",
      ownerBadgeText: "Private",
    };
  }

  return {
    relationshipBadgeText: null,
    relationshipExplanation: null,
    blockedBannerText: null,
    canOpenProfile: relationship.canViewProfile,
    canSendMessage: relationship.canSendMessage,
    canSendConnectionRequest: relationship.canSendConnectionRequest,
    ownerDisplayMode: "full",
    ownerBadgeText: null,
  };
}

export function buildProjectOwnerPresentation(
  owner: ProjectOwnerInput | null,
  relationship: PrivacyRelationshipState | null,
): ProjectOwnerPresentation | null {
  if (!owner) return null;

  const presentation = buildPrivacyPresentation(relationship);
  if (presentation.ownerDisplayMode === "masked") {
    return {
      id: owner.id,
      username: null,
      fullName: null,
      avatarUrl: null,
      displayName: "Private creator",
      isMasked: true,
      canOpenProfile: false,
      badgeText: presentation.ownerBadgeText,
    };
  }

  return {
    ...owner,
    displayName: owner.fullName || owner.username || "Creator",
    isMasked: false,
    canOpenProfile: presentation.canOpenProfile,
    badgeText: null,
  };
}

export function getPrivacyLockedShellLabel(relationship: PrivacyRelationshipState | null): string | null {
  return buildPrivacyPresentation(relationship).relationshipBadgeText;
}

export function getPrivacyBlockedMessage(relationship: PrivacyRelationshipState | null): string {
  return buildPrivacyPresentation(relationship).blockedBannerText || "You can no longer message this account";
}
