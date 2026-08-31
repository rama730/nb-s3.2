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

function PdfPreview({ name, previewUrl }: { name: string; previewUrl: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | null = null;
    setObjectUrl(null);
    setError(false);

    void fetch(previewUrl, { credentials: "same-origin" })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.toLowerCase().includes("pdf")) {
          throw new Error("PDF preview is unavailable");
        }
        const blob = await response.blob();
        if (blob.size === 0) throw new Error("PDF preview is empty");
        nextObjectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        if (!cancelled) setObjectUrl(nextObjectUrl);
        else URL.revokeObjectURL(nextObjectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [previewUrl]);

  if (error) return <ErrorFallback message="Unable to load this PDF preview." url={previewUrl} />;
  if (!objectUrl) {
    return <div className="h-full flex items-center justify-center text-sm text-zinc-500">Loading PDF…</div>;
  }
  return <iframe title={name} src={objectUrl} className="h-full w-full border-0 bg-white" />;
}

export default function AssetPreview({
  node,
  signedUrl,
}: {
  node: ProjectNode;
  signedUrl: string | null;
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

  if (kind === "pdf") {
    const previewUrl = `/api/v1/projects/${encodeURIComponent(node.projectId)}/files/${encodeURIComponent(node.id)}/preview?v=${encodeURIComponent(String(node.currentVersion))}`;
    return <PdfPreview name={node.name} previewUrl={previewUrl} />;
  }

  if (!signedUrl) {
    return <div className="h-full flex items-center justify-center text-sm text-zinc-500">Preview unavailable</div>;
  }

  if (kind === "image") {
    if (imageError) {
      return <ErrorFallback message="Failed to load image preview" url={signedUrl} />;
    }

    return (
      <div className="h-full w-full relative flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
        {/* Floating Zoom & Action Controls */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-zinc-900/80 dark:bg-zinc-950/85 backdrop-blur px-2 py-1 rounded-lg border border-zinc-200/20 shadow-md text-white">
          <Button size="sm" variant="ghost" onClick={handleZoomOut} aria-label="Zoom out" disabled={scale <= 0.5} className="h-10 w-10 p-0 text-white hover:text-white hover:bg-white/10 disabled:opacity-40">
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[10px] w-10 text-center font-medium select-none">{Math.round(scale * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={handleZoomIn} aria-label="Zoom in" disabled={scale >= 5} className="h-10 w-10 p-0 text-white hover:text-white hover:bg-white/10 disabled:opacity-40">
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} aria-label="Reset zoom" className="h-10 w-10 p-0 text-white hover:text-white hover:bg-white/10" title="Reset">
            <RotateCcw className="w-3 h-3" />
          </Button>
          <div className="w-px h-3 bg-white/20 mx-1" />
          <Button asChild size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-white hover:text-white hover:bg-white/10">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3 h-3 mr-1" />
              Open
            </a>
          </Button>
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
      <div className="h-full w-full bg-white dark:bg-zinc-950 p-4">
        <video
          src={signedUrl}
          controls
          preload="metadata"
          aria-label={`Video: ${node.name}`}
          className="w-full h-full rounded-md bg-black"
          onError={() => setVideoError(true)}
        />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="h-full w-full flex items-center justify-center p-8 bg-white dark:bg-zinc-950">
        <audio src={signedUrl} controls preload="metadata" aria-label={`Audio: ${node.name}`} className="w-full max-w-lg" />
      </div>
    );
  }

  if (kind === "doc") {
    return <div className="flex h-full items-center justify-center p-6 text-center"><div className="max-w-sm space-y-3"><FileText aria-hidden="true" className="mx-auto size-8 text-zinc-500" /><p className="break-words text-sm font-medium">{node.name}</p><p className="text-sm text-zinc-500">Download this document to preview it in your own application. Private file links are not sent to an external document viewer.</p><Button asChild variant="outline"><a href={signedUrl} target="_blank" rel="noopener noreferrer" download={node.name}>Download document</a></Button></div></div>;
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-8 text-center bg-white dark:bg-zinc-950">
      <div className="max-w-lg">
        <div className="mx-auto w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-zinc-500" />
        </div>
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{node.name}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {(node.mimeType || "unknown").toLowerCase()} · {formatBytes(node.size)}
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          This file type doesn&apos;t have an inline preview. Open it in a new tab to view.
        </div>
        <Button asChild size="sm" variant="outline" className="mt-4">
          <a href={signedUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />
            Open in new tab
          </a>
        </Button>
      </div>
    </div>
  );
}
