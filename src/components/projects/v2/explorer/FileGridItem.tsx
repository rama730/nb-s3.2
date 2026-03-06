import React, { useState, useEffect } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { FileText, Folder, Film, Image as ImageIcon, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAssetLike } from "../utils/fileKind";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";

function GridThumbnail({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  
  useEffect(() => {
    let active = true;
    getProjectFileSignedUrl(projectId, nodeId, 3600)
      .then((res) => {
         if (active && res?.url) setUrl(res.url);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [projectId, nodeId]);

  if (!url) return <ImageIcon className="w-8 h-8 text-purple-300 animate-pulse delay-150" />;
  
  return <img src={url} alt="Thumbnail" className="w-full h-full object-cover rounded-md" loading="lazy" />;
}

interface FileGridItemProps {
  node: ProjectNode;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  childrenCount?: number;
  onDropOnFolder?: (folderId: string, draggedId: string) => void;
}

export const FileGridItem = React.memo(function FileGridItem({
  node,
  selected,
  onSelect,
  onDoubleClick,
  childrenCount,
  onDropOnFolder,
}: FileGridItemProps) {
  const isFolder = node.type === "folder";
  
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/vnd.code-explorer-nodes", JSON.stringify([node.id]));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleMouseEnter = () => {
    if (isFolder || !isAssetLike(node)) return;
    hoverTimerRef.current = setTimeout(() => {
      // Phase 5: Predictive Hover Pre-Fetching
      getProjectFileSignedUrl(node.projectId, node.id, 3600).catch(() => {});
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isFolder || !onDropOnFolder) return;
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/vnd.code-explorer-nodes"));
      if (Array.isArray(data) && data[0] && data[0] !== node.id) {
          onDropOnFolder(node.id, data[0]);
      }
    } catch (err) {}
  };
  
  const getIcon = () => {
    if (isFolder) {
      if (node.name.startsWith(".git") || node.name === ".vscode" || node.name === "node_modules") {
        return <Folder className="w-8 h-8 text-zinc-400 dark:text-zinc-600 opacity-60" />;
      }
      if (node.name === "src" || node.name === "lib" || node.name === "components" || node.name === "pages" || node.name === "app") {
        return <Folder className="w-8 h-8 text-indigo-500" />;
      }
      if (node.name === "public" || node.name === "assets" || node.name === "media") {
        return <ImageIcon className="w-8 h-8 text-teal-500" />;
      }
      return <Folder className="w-8 h-8 text-blue-500" />;
    }
    
    if (isAssetLike(node)) {
       if (node.mimeType?.startsWith("image/")) return <GridThumbnail projectId={node.projectId} nodeId={node.id} />;
       if (node.mimeType?.startsWith("video/")) return <Film className="w-8 h-8 text-rose-500" />;
       if (node.mimeType?.startsWith("audio/")) return <Music className="w-8 h-8 text-pink-500" />;
    }
    
    // Default or Code
    return <FileText className="w-8 h-8 text-zinc-400" />;
  };

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "group flex flex-col items-center p-2 rounded-lg cursor-pointer border transition-all duration-200",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800/50",
        selected
          ? "bg-indigo-50 border-indigo-200 dark:bg-indigo-500/20 dark:border-indigo-500/30"
          : "bg-transparent border-transparent"
      )}
    >
      <div className={cn(
          "w-16 h-16 mb-2 flex items-center justify-center rounded-md bg-zinc-50 dark:bg-zinc-900 shadow-sm border border-zinc-100 dark:border-zinc-800",
           selected && "border-indigo-200 dark:border-indigo-500/30"
      )}>
        {getIcon()}
      </div>
      <div className="w-full text-center">
        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate w-full px-1">
          {node.name}
        </div>
        {!isFolder ? (
            <div className="text-[10px] text-zinc-400 mt-0.5">
                {formatBytes(node.size || 0)}
            </div>
        ) : (
            childrenCount !== undefined ? (
              <div className="text-[10px] text-zinc-400 mt-0.5">
                  {childrenCount} item{childrenCount !== 1 ? 's' : ''}
              </div>
            ) : null
        )}
      </div>
    </div>
  );
});

function formatBytes(bytes: number, decimals = 1) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
