"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Briefcase, Check, Clock, Loader2, Lock, MapPin, MessageSquare, UserPlus, Users, X } from "lucide-react";
import type { SuggestedProfile } from "@/app/actions/connections";
import { SkillChip } from "@/components/skills/SkillChip";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { buildPrivacyPresentation } from "@/lib/privacy/presentation";
import { getRolePreferences } from "@/lib/profile/role-preferences";
import { profileHref } from "@/lib/routing/identifiers";
import { canonicalSkillKey, matchingSkillLabels } from "@/lib/skills/matching";
import { formatLastActive } from "@/lib/ui/date-formatting";
import { buildProfileStatusSummary } from "@/lib/ui/status-config";
import { cn } from "@/lib/utils";

export interface PersonCardProps {
  profile: SuggestedProfile;
  onConnect: (userId: string) => Promise<void>;
  onDismiss?: (userId: string) => Promise<void>;
  priority?: boolean;
  viewerProjectIds?: Set<string>;
  viewerSkills?: string[];
}

function ContextLine({ profile, viewerProjectIds }: { profile: SuggestedProfile; viewerProjectIds?: Set<string> }) {
  const parts: ReactNode[] = [];
  const activeProjects = (profile.projects ?? []).filter((project) => project.status !== "archived");
  const sharedProject = viewerProjectIds ? activeProjects.find((project) => viewerProjectIds.has(project.id)) : null;

  if (sharedProject) {
    parts.push(<span key="shared" className="inline-flex min-w-0 items-center gap-1 font-medium text-primary"><Briefcase className="h-3 w-3 shrink-0" /><span className="truncate">Also on {sharedProject.title}</span></span>);
  } else if (activeProjects.length > 0) {
    parts.push(<span key="projects" className="inline-flex min-w-0 items-center gap-1"><Briefcase className="h-3 w-3 shrink-0" /><span className="truncate">{activeProjects.length === 1 ? activeProjects[0]!.title : `${activeProjects.length} projects`}</span></span>);
  }
  if ((profile.mutualConnections ?? 0) > 0) parts.push(<span key="mutual" className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{profile.mutualConnections} mutual</span>);
  if (profile.location) parts.push(<span key="location" className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{profile.location}</span></span>);
  return parts.length ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{parts}</div> : null;
}

function RelationshipStatus({ status }: { status: SuggestedProfile["connectionStatus"] }) {
  if (status === "connected") return <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />Connected</span>;
  if (status === "pending_sent") return <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500"><Clock className="h-3.5 w-3.5" />Pending</span>;
  if (status === "pending_received") return <Link href="/people?tab=requests" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-primary"><Users className="h-3.5 w-3.5" />Review request</Link>;
  if (status === "blocked") return <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400"><Ban className="h-3.5 w-3.5" />Blocked</span>;
  return null;
}

export default function PersonCard({ profile, onConnect, onDismiss, priority = false, viewerProjectIds, viewerSkills }: PersonCardProps) {
  const [requestSent, setRequestSent] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const status = requestSent ? "pending_sent" : profile.connectionStatus;
  const isLocked = Boolean(profile.isLockedProfile);
  const displayName = profile.fullName || profile.username || "User";
  const statusSummary = buildProfileStatusSummary({ experienceLevel: profile.experienceLevel, activeLabel: formatLastActive(profile.lastActiveAt) });
  const privacyLabel = buildPrivacyPresentation(isLocked ? {
    viewerId: null,
    targetUserId: profile.id,
    isSelf: false,
    isConnected: false,
    hasPendingIncomingRequest: false,
    hasPendingOutgoingRequest: false,
    blockedByViewer: false,
    blockedByTarget: false,
    profileVisibility: profile.profileVisibility === "private" ? "private" : profile.profileVisibility === "connections" ? "connections" : "public",
    messagePrivacy: "connections",
    connectionPrivacy: "everyone",
    canViewProfile: false,
    canSendConnectionRequest: profile.canConnect !== false,
    canSendMessage: false,
    shouldHideFromDiscovery: false,
    visibilityReason: profile.profileVisibility === "private" ? "private" : "connections_only",
    connectionState: "none",
    latestConnectionId: null,
  } : null).relationshipBadgeText;
  const viewerSkillKeys = new Set((viewerSkills ?? []).map(canonicalSkillKey));
  const hasMatchingSkills = matchingSkillLabels(profile.skills ?? [], viewerSkills ?? []).length > 0;
  const skills = (profile.skills ?? []).slice(0, 3);
  const interests = skills.length ? (profile.interests ?? []).slice(0, 1) : (profile.interests ?? []).slice(0, 3);

  const connect = async () => {
    if (connecting || status !== "none" || profile.canConnect === false) return;
    setConnecting(true);
    setRequestSent(true);
    try {
      await onConnect(profile.id);
    } catch {
      setRequestSent(false);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <article className="group relative flex min-h-[220px] h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/60 bg-white/80 backdrop-blur-xl transition-all hover:border-zinc-300 hover:shadow-sm dark:border-white/5 dark:bg-zinc-900/80 dark:hover:border-zinc-700">
      {onDismiss && status === "none" ? <button type="button" onClick={() => void onDismiss(profile.id)} className="absolute right-2.5 top-2.5 z-10 rounded-full p-1 text-zinc-400 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label={`Dismiss ${displayName}`}><X className="h-3.5 w-3.5" /></button> : null}
      <Link href={profileHref(profile)} className="flex flex-1 flex-col p-4 focus:outline-none   ">
        <div className="flex items-start gap-3">
          <UserAvatar identity={profile} size={48} priority={priority} className="shrink-0" fallbackClassName="font-semibold text-white" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-tight text-zinc-900 transition-colors group-hover:text-primary dark:text-zinc-100">{displayName}</h3>
            {profile.username ? <p className="mt-0.5 truncate text-[11px] text-zinc-400 dark:text-zinc-500">@{profile.username}</p> : null}
            {isLocked && privacyLabel ? <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Lock className="h-3 w-3" />{privacyLabel}</span> : null}
            {!isLocked && statusSummary.parts.length ? <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{statusSummary.parts.join(" · ")}</p> : null}
          </div>
        </div>
        <div className="mt-2.5 min-h-0 flex-1">
          {!isLocked && profile.headline ? <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{profile.headline}</p> : !profile.fullName && !profile.headline && !profile.location ? <p className="text-[13px] italic text-zinc-400 dark:text-zinc-500">New member</p> : null}
          {!isLocked ? <ContextLine profile={profile} viewerProjectIds={viewerProjectIds} /> : null}
          {!isLocked && getRolePreferences(profile.openTo).length ? <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">Open to roles</span> : null}
          {!isLocked && (skills.length || interests.length) ? <div className="mt-1.5 flex flex-wrap items-center gap-1">{skills.map((skill) => <SkillChip key={skill} skill={skill} size="sm" />)}{interests.map((interest) => <span key={interest} className="rounded-full border border-dashed border-teal-400/50 px-1.5 text-[10px] text-teal-600 dark:text-teal-400">{interest}</span>)}</div> : null}
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 pb-3 pt-3 dark:border-zinc-800/50">
        {status === "none" ? <button type="button" onClick={() => void connect()} disabled={connecting || profile.canConnect === false} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors", "border-zinc-200 text-zinc-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300")}>
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}Connect
        </button> : <RelationshipStatus status={status} />}
        {profile.canSendMessage ? <Link href={`/messages?userId=${profile.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-primary hover:text-primary dark:border-zinc-700 dark:text-zinc-300"><MessageSquare className="h-3.5 w-3.5" />Message</Link> : null}
      </div>
    </article>
  );
}
