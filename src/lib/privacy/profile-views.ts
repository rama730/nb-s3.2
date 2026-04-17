import { normalizeProfile } from "@/lib/utils/normalize-profile";
import type { PrivacyRelationshipState } from "@/lib/privacy/relationship-state";

type ViewerScopedProfileSource = Record<string, unknown> & {
  id: string;
};

export type PublicProfileView = ReturnType<typeof normalizeProfile>;
export type ViewerScopedProfileView = ReturnType<typeof normalizeProfile>;
export type PrivateProfileSecurityState = {
  hasRecoveryCodes: boolean;
  recoveryCodesGeneratedAt: Date | null;
};

function shouldExposeIdentity(relationship: PrivacyRelationshipState | null, isOwner: boolean) {
  if (isOwner) return true;
  if (!relationship) return false;
  if (relationship.blockedByTarget || relationship.blockedByViewer) {
    return false;
  }
  return true;
}

function shouldExposeFullProfile(relationship: PrivacyRelationshipState | null, isOwner: boolean) {
  if (isOwner) return true;
  return !!relationship?.canViewProfile;
}

function shouldExposeLastActiveAt(relationship: PrivacyRelationshipState | null, isOwner: boolean) {
  if (isOwner) return true;
  return !!relationship?.canViewProfile && !relationship.blockedByTarget && !relationship.blockedByViewer;
}

export function buildViewerScopedProfileView(params: {
  profile: ViewerScopedProfileSource | null | undefined;
  relationship: PrivacyRelationshipState | null;
  isOwner?: boolean;
}): ViewerScopedProfileView | null {
  const normalized = normalizeProfile(params.profile);
  if (!normalized) return null;

  const isOwner = params.isOwner ?? false;
  const exposeIdentity = shouldExposeIdentity(params.relationship, isOwner);
  const exposeFullProfile = shouldExposeFullProfile(params.relationship, isOwner);
  const exposeLastActive = shouldExposeLastActiveAt(params.relationship, isOwner);

  if (exposeFullProfile) {
    return {
      ...normalized,
      lastActiveAt: exposeLastActive ? normalized.lastActiveAt ?? null : null,
    };
  }

  return {
    ...normalized,
    username: exposeIdentity ? normalized.username : null,
    fullName: exposeIdentity ? normalized.fullName : null,
    avatarUrl: exposeIdentity ? normalized.avatarUrl : null,
    headline: exposeIdentity ? normalized.headline : null,
    location: exposeIdentity ? normalized.location : null,
    bio: null,
    website: null,
    bannerUrl: null,
    socialLinks: {},
    openTo: [],
    skills: [],
    interests: [],
    experience: [],
    education: [],
    lastActiveAt: null,
    messagePrivacy: null,
  };
}
