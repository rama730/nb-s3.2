"use client";

import React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { fileKind } from "../utils/fileKind";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText } from "lucide-react";

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export default function AssetPreview({
  node,
  signedUrl,
}: {
  node: ProjectNode;
  signedUrl: string;
}) {
  const kind = fileKind(node);

  if (!signedUrl) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500">
        Preview unavailable
      </div>
    );
  }

  if (kind === "image") {
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
        <div className="flex-1 min-h-0 flex items-center justify-center p-4">
          <img
            src={signedUrl}
            alt={node.name}
            className="max-h-full max-w-full object-contain rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (kind === "video") {
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
          <video src={signedUrl} controls className="w-full h-full rounded-md bg-black" />
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
          <audio src={signedUrl} controls className="w-full" />
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
          <iframe
            title={node.name}
            src={signedUrl}
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    );
  }

  if (kind === "doc") {
    // encodeURIComponent is crucial for the viewer
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
            {(node.mimeType || "unknown").toLowerCase()} • {formatBytes(node.size)}
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            This file type doesn’t have an inline preview yet. Use “Open” to view it in a new tab.
          </div>
        </div>
      </div>
    </div>
  );
}

