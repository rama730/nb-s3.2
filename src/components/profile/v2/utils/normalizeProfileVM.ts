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
  const p = profile || {};

  const openTo: string[] =
    (Array.isArray(p.openTo) && p.openTo) ||
    (Array.isArray(p.open_to) && p.open_to) ||
    (Array.isArray(p.skills) ? p.skills.slice(0, 5) : []);

  const availabilityStatus =
    p.availabilityStatus ||
    p.availability_status ||
    'available';

  const socialLinks: Record<string, string> =
    (p.socialLinks && typeof p.socialLinks === 'object' ? p.socialLinks : null) ||
    (p.social_links && typeof p.social_links === 'object' ? p.social_links : null) ||
    {};

  return {
    id: p.id,
    username: p.username ?? null,
    fullName: p.fullName ?? p.full_name ?? null,
    avatarUrl: p.avatarUrl ?? p.avatar_url ?? null,
    headline: p.headline ?? null,
    location: p.location ?? null,
    website: p.website ?? null,
    profileStrength: p.profileStrength ?? null,
    openTo,
    availabilityStatus,
    socialLinks,
  };
}

