"use client";

import React from "react";
import { CheckSquare, Clock3, Loader2, MessageCircle, Paperclip, RefreshCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { UserAvatar } from "@/components/ui/UserAvatar";
import type { TaskActivityItem } from "@/lib/projects/task-presentation";

interface ActivityTabProps {
  items: TaskActivityItem[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
}

function iconForActivity(type: TaskActivityItem["type"]) {
  if (type === "comment_created") return MessageCircle;
  if (type === "file_linked") return Paperclip;
  if (type === "subtask_created" || type === "subtask_updated") return CheckSquare;
  return RefreshCcw;
}

export default function ActivityTab({ items, isLoading, error, onRefresh }: ActivityTabProps) {
  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Activity</h3>
          <p className="text-xs text-zinc-500">Persisted task events only, newest first.</p>
        </div>
        <button
          onClick={() => void onRefresh()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No persisted activity yet.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const Icon = iconForActivity(item.type);

            return (
              <div
                key={item.id}
                className="flex gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.summary}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true })}
                    </span>
                  </div>

                  {item.actor ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <UserAvatar
                        identity={{
                          fullName: item.actor.fullName,
                          avatarUrl: item.actor.avatarUrl,
                        }}
                        size={20}
                        className="h-5 w-5"
                        fallbackClassName="text-[9px]"
                      />
                      <span>{item.actor.fullName || "Unknown user"}</span>
                    </div>
                  ) : null}

                  {item.detail ? (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.detail}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
