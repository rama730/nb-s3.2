"use client";

import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { profileHref } from "@/lib/routing/identifiers";

export type IncomingProjectApplication = {
  id: string;
  isWorkflowItem?: boolean;
  projectId: string | null;
  projectTitle: string;
  projectSlug?: string | null;
  roleTitle: string;
  createdAt?: string | Date | null;
  actor?: {
    id?: string | null;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
  applicant: {
    id: string;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
};

type IncomingProjectApplicationRowProps = {
  app: IncomingProjectApplication;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
};

export function IncomingProjectApplicationRow({
  app,
  busy,
  onAccept,
  onReject,
}: IncomingProjectApplicationRowProps) {
  const actor = app.actor ?? app.applicant;
  const actorName = actor.fullName || actor.username || "User";
  const projectHref = `/projects/${app.projectSlug || app.projectId}`;
  const sourceLabel = app.isWorkflowItem ? "Project invitation" : "Project application";
  const receivedAt = app.createdAt
    ? formatDistanceToNowStrict(new Date(app.createdAt), { addSuffix: true })
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/60 bg-white/80 p-4 backdrop-blur-xl sm:flex-row sm:items-start dark:border-white/5 dark:bg-zinc-900/80">
      <Link href={profileHref(actor)} className="w-fit">
        <UserAvatar identity={actor} size={40} />
      </Link>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={profileHref(actor)}
            className="truncate text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100"
          >
            {actorName}
          </Link>
          <span className="text-xs text-zinc-400">
            {app.isWorkflowItem ? "invited you to join as" : "applied for"}
          </span>
          <span className="truncate text-xs font-medium text-primary">{app.roleTitle}</span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {sourceLabel}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
          <Link href={projectHref} className="truncate hover:text-primary">
            {app.projectTitle}
          </Link>
          {receivedAt ? <span aria-label={`Received ${receivedAt}`}>{receivedAt}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <Button size="sm" onClick={onAccept} disabled={busy} aria-label={`Accept ${sourceLabel.toLowerCase()} from ${actorName} for ${app.projectTitle}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={busy} aria-label={`Reject ${sourceLabel.toLowerCase()} from ${actorName} for ${app.projectTitle}`}>
          <X className="h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
    </div>
  );
}
