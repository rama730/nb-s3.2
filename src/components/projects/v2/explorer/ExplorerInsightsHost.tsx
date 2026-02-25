"use client";

import React from "react";
import { Link2, Loader2 } from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";

interface ExplorerInsightsHostProps {
  isInsightsOpen: boolean;
  selectedNode: ProjectNode | null;
  insightsLoading: boolean;
  insightsError: string | null;
  linkedTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    taskNumber: number | null;
  }>;
  nodeActivity: Array<{
    id: string;
    type: string;
    at: number;
    by: string | null;
  }>;
}

export function ExplorerInsightsHost({
  isInsightsOpen,
  selectedNode,
  insightsLoading,
  insightsError,
  linkedTasks,
  nodeActivity,
}: ExplorerInsightsHostProps) {
  if (!isInsightsOpen) return null;

  return (
    <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
      <div className="px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        Node Insights
        {selectedNode ? (
          <span className="ml-2 font-normal text-zinc-500 truncate">{selectedNode.name}</span>
        ) : null}
      </div>
      <div className="max-h-44 overflow-auto px-2 pb-2 space-y-2">
        {!selectedNode ? (
          <div className="text-[11px] text-zinc-500 px-1 py-1">
            Select a file or folder to inspect linked tasks and activity.
          </div>
        ) : insightsLoading ? (
          <div className="text-[11px] text-zinc-500 px-1 py-1 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading insights...
          </div>
        ) : insightsError ? (
          <div className="text-[11px] text-red-500 px-1 py-1">{insightsError}</div>
        ) : (
          <>
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
              <div className="text-[11px] font-semibold mb-1 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                Linked Tasks ({linkedTasks.length})
              </div>
              {linkedTasks.length === 0 ? (
                <div className="text-[11px] text-zinc-500">No task links for this node.</div>
              ) : (
                <div className="space-y-1">
                  {linkedTasks.slice(0, 6).map((task) => (
                    <div
                      key={task.id}
                      className="text-[11px] rounded-sm bg-zinc-100/70 dark:bg-zinc-800/70 px-1.5 py-1"
                    >
                      <div className="font-medium truncate">
                        {task.taskNumber ? `#${task.taskNumber} ` : ""}
                        {task.title}
                      </div>
                      <div className="text-zinc-500 uppercase tracking-wide">
                        {task.status} • {task.priority}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
              <div className="text-[11px] font-semibold mb-1">Recent Activity</div>
              {nodeActivity.length === 0 ? (
                <div className="text-[11px] text-zinc-500">No activity recorded yet.</div>
              ) : (
                <div className="space-y-1">
                  {nodeActivity.slice(0, 6).map((entry) => (
                    <div
                      key={entry.id}
                      className="text-[11px] rounded-sm bg-zinc-100/70 dark:bg-zinc-800/70 px-1.5 py-1"
                    >
                      <div className="font-medium truncate">{entry.type.replaceAll("_", " ")}</div>
                      <div className="text-zinc-500 truncate">
                        {entry.by || "system"} • {new Date(entry.at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
