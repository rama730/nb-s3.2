"use client";

import type { Profile } from "@/lib/db/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toFormState } from "@/lib/profile/normalization";

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
    availabilityStatus: profile.availability_status,
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
  return (profile.experience ?? profile.experience_data) === undefined
    || (profile.education ?? profile.education_data) === undefined;
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

export async function loadProfileEditRefreshState(profileId: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, headline, bio, location, website, avatar_url, banner_url, availability_status, open_to, skills, social_links, experience, education, updated_at")
    .eq("id", profileId)
    .single();
  if (error || !data) return null;
  return {
    formState: toFormState(data),
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : new Date().toISOString(),
  };
}
