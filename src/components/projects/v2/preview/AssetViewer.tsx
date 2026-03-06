"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Download,
  Info,
} from "lucide-react";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useShallow } from "zustand/react/shallow";
import type { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import AssetPreview from "./AssetPreview";
import AssetMetadataPanel from "./AssetMetadataPanel";
import { isAssetLike, fileKind } from "../utils/fileKind";
import { parentKey } from "@/stores/files/types";

interface AssetViewerProps {
  projectId: string;
  node: ProjectNode;
  signedUrl: string;
  onNavigateToAsset?: (node: ProjectNode) => void;
  onClose?: () => void;
}

function FilmstripThumb({
  node,
  url,
  active,
  onClick,
}: {
  node: ProjectNode;
  url: string | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const kind = fileKind(node);
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative shrink-0 w-16 h-12 rounded-md overflow-hidden border-2 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        active
          ? "border-blue-500 ring-1 ring-blue-500/40"
          : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500",
      )}
      title={node.name}
    >
      {kind === "image" && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={node.name}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800">
          <span className="text-[10px] font-mono text-zinc-500 uppercase truncate px-1">
            {kind === "video" ? "VID" : kind === "audio" ? "AUD" : kind === "pdf" ? "PDF" : "FILE"}
          </span>
        </div>
      )}
    </button>
  );
}

export default function AssetViewer({
  projectId,
  node,
  signedUrl,
  onNavigateToAsset,
  onClose,
}: AssetViewerProps) {
  const [showMetadata, setShowMetadata] = useState(false);
  const filmstripRef = useRef<HTMLDivElement>(null);

  const siblings = useFilesWorkspaceStore(
    useShallow((s) => {
      const ws = s._get(projectId);
      const pk = parentKey(node.parentId);
      const childIds = ws.childrenByParentId[pk];
      if (!childIds) return [];
      return childIds
        .map((id) => ws.nodesById[id])
        .filter((n): n is ProjectNode => !!n && isAssetLike(n));
    })
  );

  const currentIndex = useMemo(
    () => siblings.findIndex((s) => s.id === node.id),
    [siblings, node.id],
  );

  const prevAsset = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextAsset = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  const signedUrls = useFilesWorkspaceStore((s) => s._get(projectId).signedUrls);

  const navigate = useCallback(
    (target: ProjectNode | null) => {
      if (target && onNavigateToAsset) onNavigateToAsset(target);
    },
    [onNavigateToAsset],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(prevAsset);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(nextAsset);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      } else if (e.key === "i" && !e.metaKey && !e.ctrlKey) {
        setShowMetadata((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prevAsset, nextAsset, navigate, onClose]);

  useEffect(() => {
    if (!filmstripRef.current) return;
    const activeThumb = filmstripRef.current.querySelector("[data-active='true']");
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [currentIndex]);

  const handleDownload = useCallback(() => {
    window.open(signedUrl, "_blank", "noopener");
  }, [signedUrl]);

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={!prevAsset}
                  onClick={() => navigate(prevAsset)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Previous asset (←)</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <span className="text-xs font-mono truncate max-w-[260px]" title={node.name}>
            {node.name}
          </span>

          {siblings.length > 1 && (
            <span className="text-[10px] text-zinc-400 tabular-nums">
              {currentIndex + 1}/{siblings.length}
            </span>
          )}

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={!nextAsset}
                  onClick={() => navigate(nextAsset)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Next asset (→)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={showMetadata ? "secondary" : "ghost"}
                  className="h-7 w-7 p-0"
                  onClick={() => setShowMetadata((v) => !v)}
                >
                  <Info className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Toggle info panel (I)</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <AssetPreview node={node} signedUrl={signedUrl} />
        </div>

        {showMetadata && (
          <AssetMetadataPanel
            node={node}
            signedUrl={signedUrl}
            onDownload={handleDownload}
            onCopyUrl={() => {
              navigator.clipboard.writeText(signedUrl);
            }}
          />
        )}
      </div>

      {/* Filmstrip */}
      {siblings.length > 1 && (
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2">
          <div
            ref={filmstripRef}
            className="flex gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700"
          >
            {siblings.map((sibling) => (
              <div key={sibling.id} data-active={sibling.id === node.id ? "true" : undefined}>
                <FilmstripThumb
                  node={sibling}
                  url={signedUrls[sibling.id]?.url}
                  active={sibling.id === node.id}
                  onClick={() => navigate(sibling)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
