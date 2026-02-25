"use client";

import { ExternalLink, FileText, ZoomIn, ZoomOut, RotateCcw, AlertTriangle } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import type { ProjectNode } from "@/lib/db/schema";
import { fileKind } from "../utils/fileKind";
import { Button } from "@/components/ui/button";

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function ErrorFallback({ message, url }: { message: string; url: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
      <AlertTriangle className="w-8 h-8 text-amber-500" />
      <p className="text-sm text-zinc-500">{message}</p>
      <Button asChild size="sm" variant="outline">
        <a href={url} target="_blank" rel="noreferrer">
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in new tab
        </a>
      </Button>
    </div>
  );
}

export default function AssetPreview({
  node,
  signedUrl,
}: {
  node: ProjectNode;
  signedUrl: string;
}) {
  const kind = fileKind(node);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(s + 0.5, 5)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(s - 0.5, 0.5)), []);
  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || kind !== "image") return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((s) => Math.min(Math.max(s + delta, 0.5), 5));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [kind]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  }, [isDragging]);

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  if (!signedUrl) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500">
        Preview unavailable
      </div>
    );
  }

  if (kind === "image") {
    if (imageError) {
      return <ErrorFallback message="Failed to load image preview" url={signedUrl} />;
    }

    return (
      <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 z-10 bg-white dark:bg-zinc-950">
          <div className="text-xs font-mono truncate mr-2">{node.name}</div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={handleZoomOut} disabled={scale <= 0.5} className="h-7 w-7 p-0">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-xs w-12 text-center text-zinc-500">{Math.round(scale * 100)}%</span>
            <Button size="sm" variant="ghost" onClick={handleZoomIn} disabled={scale >= 5} className="h-7 w-7 p-0">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleReset} className="h-7 w-7 p-0" title="Reset">
              <RotateCcw className="w-3 h-3" />
            </Button>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <Button asChild size="sm" variant="outline" className="h-7">
              <a href={signedUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open
              </a>
            </Button>
          </div>
        </div>
        <div
          ref={containerRef}
          className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden relative bg-zinc-50/50 dark:bg-zinc-900/50 cursor-grab active:cursor-grabbing"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <Image
            src={signedUrl}
            alt={node.name}
            width={1600}
            height={900}
            sizes="(max-width: 768px) 100vw, 80vw"
            loading="lazy"
            className="max-h-full max-w-full object-contain transition-transform duration-75 ease-out select-none"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            }}
            draggable={false}
            onError={() => setImageError(true)}
          />
        </div>
      </div>
    );
  }

  if (kind === "video") {
    if (videoError) {
      return <ErrorFallback message="Failed to load video preview" url={signedUrl} />;
    }

    return (
      <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-xs font-mono truncate">{node.name}</div>
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open
            </a>
          </Button>
        </div>
        <div className="flex-1 min-h-0 p-4">
          <video
            src={signedUrl}
            controls
            preload="metadata"
            aria-label={`Video: ${node.name}`}
            className="w-full h-full rounded-md bg-black"
            onError={() => setVideoError(true)}
          />
        </div>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-xs font-mono truncate">{node.name}</div>
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open
            </a>
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center p-8">
          <audio src={signedUrl} controls preload="metadata" aria-label={`Audio: ${node.name}`} className="w-full" />
        </div>
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-xs font-mono truncate">{node.name}</div>
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open
            </a>
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <object
            data={signedUrl}
            type="application/pdf"
            title={node.name}
            className="w-full h-full border-0 bg-white"
          >
            <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
              <FileText className="w-8 h-8 text-zinc-400" />
              <p className="text-sm text-zinc-500">PDF preview not supported in this browser.</p>
              <Button asChild size="sm" variant="outline">
                <a href={signedUrl} target="_blank" rel="noreferrer">Download PDF</a>
              </Button>
            </div>
          </object>
        </div>
      </div>
    );
  }

  if (kind === "doc") {
    const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(signedUrl)}&embedded=true`;
    return (
      <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-xs font-mono truncate">{node.name}</div>
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open
            </a>
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <iframe
            title={node.name}
            src={viewerUrl}
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="text-xs font-mono truncate">{node.name}</div>
        <Button asChild size="sm" variant="outline" className="h-7">
          <a href={signedUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />
            Open
          </a>
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-center">
        <div className="max-w-lg">
          <div className="mx-auto w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
            <FileText className="w-6 h-6 text-zinc-500" />
          </div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{node.name}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {(node.mimeType || "unknown").toLowerCase()} · {formatBytes(node.size)}
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            This file type doesn&apos;t have an inline preview yet. Use &quot;Open&quot; to view it in a new tab.
          </div>
        </div>
      </div>
    </div>
  );
}
