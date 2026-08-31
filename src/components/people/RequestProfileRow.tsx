import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { profileHref } from "@/lib/routing/identifiers";

export type RequestProfile = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  location: string | null;
};

/** Shared request row for the Connections queue and Workspace launcher. */
export function RequestProfileRow({
  profile,
  requestedAt,
  actions,
}: {
  profile: RequestProfile;
  requestedAt: Date | string;
  actions: ReactNode;
}) {
  const name = profile.fullName || profile.username || "User";

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-zinc-200/60 bg-white/80 p-4 backdrop-blur-xl transition-colors hover:border-zinc-300 dark:border-white/5 dark:bg-zinc-900/80 dark:hover:border-zinc-700">
      <Link href={profileHref(profile)} className="shrink-0">
        <UserAvatar identity={profile} size={40} />
      </Link>
      <Link href={profileHref(profile)} className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-zinc-900 hover:text-primary dark:text-zinc-100">{name}</h3>
        {profile.headline ? <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{profile.headline}</p> : null}
        {profile.location ? <p className="mt-0.5 truncate text-[11px] text-zinc-400">{profile.location}</p> : null}
      </Link>
      <p className="hidden shrink-0 text-xs text-zinc-400 sm:block">
        {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
      </p>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
