"use client";

import type { Profile } from "@/lib/db/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";

export function normalizeProfileRecord(profile: Record<string, any> | null): Profile | null {
  if (!profile) return null;
  const snake = "full_name" in profile || "avatar_url" in profile;
  if (!snake) return profile as Profile;
  return {
    ...profile,
    avatarUrl: profile.avatar_url,
    fullName: profile.full_name,
    bannerUrl: profile.banner_url,
    socialLinks: profile.social_links || {},
    messagePrivacy: profile.message_privacy,
    connectionPrivacy: profile.connection_privacy,
    openTo: profile.open_to || [],
    experienceLevel: profile.experience_level,
    hoursPerWeek: profile.hours_per_week,
    genderIdentity: profile.gender_identity,
    connectionsCount: profile.connections_count ?? 0,
    projectsCount: profile.projects_count ?? 0,
    followersCount: profile.followers_count ?? 0,
    workspaceInboxCount: profile.workspace_inbox_count ?? 0,
    workspaceDueTodayCount: profile.workspace_due_today_count ?? 0,
    workspaceOverdueCount: profile.workspace_overdue_count ?? 0,
    workspaceInProgressCount: profile.workspace_in_progress_count ?? 0,
    createdAt: profile.created_at ? new Date(profile.created_at) : undefined,
    updatedAt: profile.updated_at ? new Date(profile.updated_at) : undefined,
    deletedAt: profile.deleted_at ? new Date(profile.deleted_at) : undefined,
  } as unknown as Profile;
}

export function profileNeedsHydration(profile: Record<string, any> | null): boolean {
  if (!profile || typeof profile !== "object") return false;
  return (profile.education ?? profile.education_data) === undefined;
}

export async function loadBrowserProfile(userId: string): Promise<Profile | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, username, created_at, updated_at, deleted_at")
    .eq("id", userId)
    .single();
  return normalizeProfileRecord(data);
}

export type ProfileContributionPage = {
  contributions: ProfileCollaborationContribution[];
  total: number;
  hasMore: boolean;
};

export async function loadProfileContributionsPage(
  profileId: string,
  options: { limit?: number; offset?: number; stageLimit?: number } = {},
): Promise<ProfileContributionPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const stageLimit = Math.min(Math.max(options.stageLimit ?? 8, 1), 20);
  const response = await fetch(
    `/api/v1/profiles/${encodeURIComponent(profileId)}/contributions?limit=${limit}&offset=${offset}&stageLimit=${stageLimit}`,
    { credentials: "include", cache: "no-store", headers: { accept: "application/json" } },
  );
  const body = await response.json().catch(() => null) as {
    success?: boolean;
    message?: string;
    data?: Partial<ProfileContributionPage>;
  } | null;
  if (!response.ok || body?.success !== true) {
    throw new Error(body?.message || "Could not load project contributions");
  }
  const contributions = body.data?.contributions ?? [];
  const total = Number(body.data?.total ?? contributions.length);
  return {
    contributions,
    total: Number.isFinite(total) ? total : contributions.length,
    hasMore: Boolean(body.data?.hasMore),
  };
}

/** Refreshes only the contribution window already opened by the editor. */
export async function loadProfileContributionWindow(profileId: string, desiredCount: number) {
  const target = Math.min(Math.max(desiredCount, 1), 500);
  const contributions: ProfileCollaborationContribution[] = [];
  let total = 0;
  let hasMore = false;
  for (let offset = 0; offset < target; offset += 50) {
    const page = await loadProfileContributionsPage(profileId, {
      limit: Math.min(50, target - offset),
      offset,
      stageLimit: 8,
    });
    contributions.push(...page.contributions);
    total = page.total;
    hasMore = page.hasMore;
    if (!page.hasMore || page.contributions.length === 0) break;
  }
  return { contributions, total, hasMore };
}
