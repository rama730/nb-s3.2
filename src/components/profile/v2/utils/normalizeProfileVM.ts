import { normalizeProfile } from '@/lib/utils/normalize-profile'

export type NormalizedProfileVM = {
  id: string;
  username?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
  location?: string | null;
  website?: string | null;
  profileStrength?: number | null;

  openTo: string[];
  availabilityStatus: string;
  socialLinks: Record<string, string>;
};

export function normalizeProfileVM(profile: any): NormalizedProfileVM {
  const normalized = normalizeProfile(profile);
  if (!normalized) {
    return {
      id: '',
      username: null,
      fullName: null,
      avatarUrl: null,
      headline: null,
      location: null,
      website: null,
      profileStrength: null,
      openTo: [],
      availabilityStatus: 'available',
      socialLinks: {},
    };
  }

  return {
    id: normalized.id,
    username: normalized.username ?? null,
    fullName: normalized.fullName ?? null,
    avatarUrl: normalized.avatarUrl ?? null,
    headline: normalized.headline ?? null,
    location: normalized.location ?? null,
    website: normalized.website ?? null,
    profileStrength: normalized.profileStrength ?? null,
    openTo: normalized.openTo,
    availabilityStatus: normalized.availabilityStatus,
    socialLinks: normalized.socialLinks,
  };
}
