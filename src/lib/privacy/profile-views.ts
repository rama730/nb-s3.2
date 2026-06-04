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

function buildSafeProfileShape(normalized: NonNullable<ReturnType<typeof normalizeProfile>>, options: {
  exposeIdentity: boolean;
  exposeFullProfile: boolean;
  exposeLastActive: boolean;
}) {
  const identity = {
    id: normalized.id,
    username: options.exposeIdentity ? normalized.username : null,
    fullName: options.exposeIdentity ? normalized.fullName : null,
    avatarUrl: options.exposeIdentity ? normalized.avatarUrl : null,
    headline: options.exposeIdentity ? normalized.headline : null,
    location: options.exposeIdentity ? normalized.location : null,
    visibility: normalized.visibility ?? "public",
    availabilityStatus: normalized.availabilityStatus,
    profileStrength: normalized.profileStrength,
    completionMissing: normalized.completionMissing,
    connectionsCount: normalized.connectionsCount,
    projectsCount: normalized.projectsCount,
    followersCount: normalized.followersCount,
  };

  if (!options.exposeFullProfile) {
    return {
      ...identity,
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
      connectionPrivacy: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    ...identity,
    bio: normalized.bio,
    website: normalized.website,
    bannerUrl: normalized.bannerUrl,
    socialLinks: normalized.socialLinks,
    openTo: normalized.openTo,
    skills: normalized.skills,
    interests: normalized.interests,
    experience: normalized.experience,
    education: normalized.education,
    lastActiveAt: options.exposeLastActive ? normalized.lastActiveAt ?? null : null,
    messagePrivacy: normalized.messagePrivacy ?? null,
    connectionPrivacy: normalized.connectionPrivacy ?? null,
    createdAt: normalized.createdAt ?? null,
    updatedAt: normalized.updatedAt ?? null,
  };
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

  return buildSafeProfileShape(normalized, {
    exposeIdentity,
    exposeFullProfile,
    exposeLastActive,
  });
}
