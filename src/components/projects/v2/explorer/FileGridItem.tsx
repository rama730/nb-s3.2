import React from "react";
import { ProjectNode } from "@/lib/db/schema";
import { FileText, Folder, Film, Image as ImageIcon, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAssetLike } from "../utils/fileKind";

interface FileGridItemProps {
  node: ProjectNode;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export const FileGridItem = React.memo(function FileGridItem({
  node,
  selected,
  onSelect,
  onDoubleClick,
}: FileGridItemProps) {
  const isFolder = node.type === "folder";
  
  const getIcon = () => {
    if (isFolder) return <Folder className="w-8 h-8 text-blue-500" />;
    
    if (isAssetLike(node)) {
       if (node.mimeType?.startsWith("image/")) return <ImageIcon className="w-8 h-8 text-purple-500" />;
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
        {!isFolder && (
            <div className="text-[10px] text-zinc-400 mt-0.5">
                {formatBytes(node.size || 0)}
            </div>
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
