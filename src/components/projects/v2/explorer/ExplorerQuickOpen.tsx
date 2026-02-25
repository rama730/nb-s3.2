"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes } from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { formatBytes } from "./explorerTypes";

export function ExplorerQuickOpen({
  quickOpen,
  setQuickOpen,
  projectId,
  nodesById,
  recents,
  handleSelect,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  quickOpen: { open: boolean; query: string };
  setQuickOpen: React.Dispatch<React.SetStateAction<{ open: boolean; query: string }>>;
  projectId: string;
  nodesById: Record<string, ProjectNode>;
  recents: string[];
  handleSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);

  const [quickOpenResults, setQuickOpenResults] = useState<ProjectNode[]>([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const quickOpenRequestIdRef = useRef(0);

  useEffect(() => {
    if (!quickOpen.open) return;
    const q = quickOpen.query.trim();

    if (!q) {
      const recentNodes = recents
        .map((id) => nodesById[id])
        .filter((n): n is ProjectNode => !!n && n.type === "file")
        .slice(0, 20);
      setQuickOpenResults(recentNodes);
      return;
    }
    if (q.length < 2) {
      setQuickOpenResults([]);
      setQuickOpenLoading(false);
      quickOpenRequestIdRef.current += 1;
      return;
    }

    const requestId = ++quickOpenRequestIdRef.current;
    const t = setTimeout(async () => {
      setQuickOpenLoading(true);
      try {
        const nodes = (await getProjectNodes(projectId, null, q)) as ProjectNode[];
        if (requestId !== quickOpenRequestIdRef.current) return;
        const files = nodes.filter((n) => n.type === "file").slice(0, 50);
        upsertNodes(projectId, files);
        setQuickOpenResults(files);
      } finally {
        if (requestId === quickOpenRequestIdRef.current) {
          setQuickOpenLoading(false);
        }
      }
    }, 150);

    return () => clearTimeout(t);
  }, [projectId, quickOpen.open, quickOpen.query, upsertNodes, nodesById, recents]);

  return (
    <Dialog
      open={quickOpen.open}
      onOpenChange={(open) => setQuickOpen((s) => ({ ...s, open }))}
    >
      <DialogContent
        className={nestedDialogClassName}
        overlayClassName={nestedDialogOverlayClassName}
      >
        <DialogHeader>
          <DialogTitle>Quick Open</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            placeholder="Type a filename…"
            value={quickOpen.query}
            onChange={(e) => setQuickOpen((s) => ({ ...s, query: e.target.value }))}
          />
          <div className="max-h-[320px] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {quickOpenLoading ? (
              <div className="p-3 text-sm text-zinc-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching…
              </div>
            ) : quickOpenResults.length === 0 ? (
              <div className="p-3 text-sm text-zinc-500">No matches</div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {quickOpenResults.map((n) => (
                  <button
                    key={n.id}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center gap-2"
                    onClick={() => {
                      setQuickOpen({ open: false, query: "" });
                      handleSelect(n);
                    }}
                  >
                    <FileText className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm font-medium truncate">{n.name}</span>
                    <span className="ml-auto text-xs text-zinc-400">
                      {formatBytes(n.size)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setQuickOpen({ open: false, query: "" })}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
