"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Download,
  Copy,
  Replace,
  Check,
  ImageIcon,
  Film,
  Music,
  FileText,
} from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { fileKind } from "../utils/fileKind";

interface AssetMetadataPanelProps {
  node: ProjectNode;
  signedUrl: string;
  onDownload?: () => void;
  onCopyUrl?: () => void;
  onReplace?: () => void;
}

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex justify-between items-start gap-4 py-1.5">
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
      <span className="text-[11px] text-zinc-800 dark:text-zinc-200 text-right break-all">
        {value}
      </span>
    </div>
  );
}

function kindLabel(kind: string) {
  switch (kind) {
    case "image": return "Image";
    case "video": return "Video";
    case "audio": return "Audio";
    case "pdf": return "PDF Document";
    case "doc": return "Document";
    default: return "File";
  }
}

function KindIcon({ kind }: { kind: string }) {
  const cls = "w-4 h-4";
  switch (kind) {
    case "image": return <ImageIcon className={cn(cls, "text-blue-500")} />;
    case "video": return <Film className={cn(cls, "text-purple-500")} />;
    case "audio": return <Music className={cn(cls, "text-green-500")} />;
    case "pdf": return <FileText className={cn(cls, "text-red-500")} />;
    default: return <FileText className={cn(cls, "text-zinc-400")} />;
  }
}

function useImageDimensions(signedUrl: string, kind: string) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (kind !== "image") return;
    const img = new Image();
    img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = signedUrl;
    return () => { img.onload = null; };
  }, [signedUrl, kind]);
  return dims;
}

function useMediaDuration(signedUrl: string, kind: string) {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (kind !== "video" && kind !== "audio") return;
    const el = kind === "video" ? document.createElement("video") : document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      if (isFinite(el.duration)) setDuration(el.duration);
    };
    el.src = signedUrl;
    return () => { el.onloadedmetadata = null; el.src = ""; };
  }, [signedUrl, kind]);
  return duration;
}

export default function AssetMetadataPanel({
  node,
  signedUrl,
  onDownload,
  onCopyUrl,
  onReplace,
}: AssetMetadataPanelProps) {
  const [copied, setCopied] = useState(false);
  const kind = fileKind(node);
  const dims = useImageDimensions(signedUrl, kind);
  const duration = useMediaDuration(signedUrl, kind);

  const handleCopy = () => {
    onCopyUrl?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-64 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-y-auto">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <KindIcon kind={kind} />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {kindLabel(kind)}
          </span>
        </div>

        {/* File info section */}
        <div className="mb-4">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
            File Info
          </h4>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            <MetaRow label="Name" value={node.name} />
            <MetaRow label="Size" value={formatBytes(node.size)} />
            <MetaRow label="Type" value={(node.mimeType || "unknown").toLowerCase()} />
            <MetaRow label="Created" value={formatDate(node.createdAt)} />
            <MetaRow label="Modified" value={formatDate(node.updatedAt)} />
          </div>
        </div>

        {/* Image-specific */}
        {kind === "image" && dims && (
          <div className="mb-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
              Dimensions
            </h4>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              <MetaRow label="Width" value={`${dims.width}px`} />
              <MetaRow label="Height" value={`${dims.height}px`} />
              <MetaRow label="Aspect" value={`${(dims.width / dims.height).toFixed(2)}:1`} />
            </div>
          </div>
        )}

        {/* Video/Audio-specific */}
        {(kind === "video" || kind === "audio") && duration !== null && (
          <div className="mb-4">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
              Media
            </h4>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              <MetaRow label="Duration" value={formatDuration(duration)} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 h-8 text-xs"
            onClick={onDownload}
          >
            <Download className="w-3.5 h-3.5" />
            Download original
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 h-8 text-xs"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? "Copied!" : "Copy URL"}
          </Button>

          {onReplace && (
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start gap-2 h-8 text-xs"
              onClick={onReplace}
            >
              <Replace className="w-3.5 h-3.5" />
              Replace file
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
