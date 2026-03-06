"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Folder,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  File,
  ArrowUpDown,
} from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fileKind, isAssetLike } from "../utils/fileKind";

type SortKey = "name" | "updated" | "size";

interface AssetGalleryProps {
  projectId: string;
  folderId: string;
  nodes: ProjectNode[];
  onOpenAsset: (node: ProjectNode) => void;
  onOpenFolder?: (folderId: string) => void;
}

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function kindIcon(kind: string) {
  switch (kind) {
    case "image":
      return <ImageIcon className="w-6 h-6 text-blue-500" />;
    case "video":
      return <Film className="w-6 h-6 text-purple-500" />;
    case "audio":
      return <Music className="w-6 h-6 text-green-500" />;
    case "pdf":
      return <FileText className="w-6 h-6 text-red-500" />;
    default:
      return <File className="w-6 h-6 text-zinc-400" />;
  }
}

function LazyThumb({
  node,
  signedUrl,
  onClick,
}: {
  node: ProjectNode;
  signedUrl?: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const kind = fileKind(node);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            onClick={onClick}
            className={cn(
              "group relative aspect-square rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800",
              "hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              "bg-zinc-50 dark:bg-zinc-900",
            )}
          >
            {kind === "image" && visible && signedUrl ? (
              <>
                {!loaded && (
                  <div className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signedUrl}
                  alt={node.name}
                  className={cn(
                    "w-full h-full object-cover transition-opacity duration-200",
                    loaded ? "opacity-100" : "opacity-0",
                  )}
                  loading="lazy"
                  draggable={false}
                  onLoad={() => setLoaded(true)}
                />
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2">
                {kindIcon(kind)}
                <span className="text-[10px] text-zinc-500 font-mono truncate max-w-full px-1">
                  {node.name}
                </span>
              </div>
            )}

            {/* Overlay on hover */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 pt-6">
              <p className="text-[11px] text-white truncate font-medium">{node.name}</p>
              <p className="text-[10px] text-white/70">{formatBytes(node.size)}</p>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px]">
          <p className="font-medium text-xs">{node.name}</p>
          <p className="text-[10px] text-zinc-400">
            {(node.mimeType || "unknown").toLowerCase()} · {formatBytes(node.size)}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FolderCard({
  node,
  childCount,
  onClick,
}: {
  node: ProjectNode;
  childCount?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group aspect-square rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800",
        "hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-md transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        "bg-zinc-50 dark:bg-zinc-900 flex flex-col items-center justify-center gap-2 p-3",
      )}
    >
      <Folder className="w-8 h-8 text-blue-500 group-hover:text-blue-600 transition-colors" />
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-full">
        {node.name}
      </span>
      {childCount !== undefined && (
        <span className="text-[10px] text-zinc-400">
          {childCount} {childCount === 1 ? "item" : "items"}
        </span>
      )}
    </button>
  );
}

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  updated: "Date modified",
  size: "Size",
};

export default function AssetGallery({
  nodes,
  onOpenAsset,
  onOpenFolder,
}: AssetGalleryProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const handleCycleSort = useCallback(() => {
    setSortKey((prev) => {
      const keys: SortKey[] = ["name", "updated", "size"];
      const idx = keys.indexOf(prev);
      return keys[(idx + 1) % keys.length];
    });
  }, []);

  const handleToggleDirection = useCallback(() => {
    setSortAsc((a) => !a);
  }, []);

  const { folders, assets } = useMemo(() => {
    const fArr: ProjectNode[] = [];
    const aArr: ProjectNode[] = [];
    for (const n of nodes) {
      if (n.type === "folder") fArr.push(n);
      else if (isAssetLike(n)) aArr.push(n);
    }
    return { folders: fArr, assets: aArr };
  }, [nodes]);

  const sortedAssets = useMemo(() => {
    const copy = [...assets];
    const dir = sortAsc ? 1 : -1;
    copy.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "updated": {
          const ta = new Date(a.updatedAt).getTime();
          const tb = new Date(b.updatedAt).getTime();
          return dir * (ta - tb);
        }
        case "size":
          return dir * ((a.size ?? 0) - (b.size ?? 0));
        default:
          return 0;
      }
    });
    return copy;
  }, [assets, sortKey, sortAsc]);

  const sortedFolders = useMemo(() => {
    const copy = [...folders];
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return copy;
  }, [folders]);

  if (sortedFolders.length === 0 && sortedAssets.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <ImageIcon className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm text-zinc-500">No assets in this folder</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Sort bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-xs text-zinc-500">
          {sortedAssets.length} {sortedAssets.length === 1 ? "asset" : "assets"}
          {sortedFolders.length > 0 && `, ${sortedFolders.length} folder${sortedFolders.length > 1 ? "s" : ""}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1.5 px-2"
            onClick={handleCycleSort}
          >
            <ArrowUpDown className="w-3 h-3" />
            {SORT_LABELS[sortKey]}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-[10px] font-mono"
            onClick={handleToggleDirection}
            title={sortAsc ? "Ascending" : "Descending"}
          >
            {sortAsc ? "A↓" : "Z↓"}
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {sortedFolders.map((folder) => (
            <FolderCard
              key={folder.id}
              node={folder}
              onClick={() => onOpenFolder?.(folder.id)}
            />
          ))}
          {sortedAssets.map((asset) => (
            <LazyThumb
              key={asset.id}
              node={asset}
              onClick={() => onOpenAsset(asset)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
