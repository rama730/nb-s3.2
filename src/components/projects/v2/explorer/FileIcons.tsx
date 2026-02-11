import React from "react";
import {
  FileCode,
  FileJson,
  FileText,
  FileImage,
  Box,
  Settings,
  File,
  Database,
  Globe,
  Package,
  Hash,
  Info,
  GitGraph,
  Code2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mapping of exact filenames to icons and colors
const FILE_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  // Configs
  ".gitignore": { icon: GitGraph, color: "text-orange-600" },
  ".env": { icon: Settings, color: "text-purple-500" },
  ".env.local": { icon: Settings, color: "text-purple-500" },
  "package.json": { icon: Package, color: "text-green-600" },
  "tsconfig.json": { icon: FileCode, color: "text-blue-600" },
  "next.config.js": { icon: Box, color: "text-black dark:text-white" },
  "next.config.mjs": { icon: Box, color: "text-black dark:text-white" },
  "tailwind.config.js": { icon: Box, color: "text-cyan-500" },
  "tailwind.config.ts": { icon: Box, color: "text-cyan-500" },
  "postcss.config.js": { icon: Box, color: "text-pink-500" },
  "README.md": { icon: Info, color: "text-blue-400" },
  "LICENSE": { icon: Scale, color: "text-yellow-600" }, // Scale not in lucide imports, fixing below
  "Dockerfile": { icon: Box, color: "text-blue-600" },
  "docker-compose.yml": { icon: Box, color: "text-blue-600" },
};

// Mapping of extensions to icons and colors
const EXT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  ts: { icon: FileCode, color: "text-blue-500" },
  tsx: { icon: Code2, color: "text-blue-400" },
  js: { icon: FileCode, color: "text-yellow-400" },
  jsx: { icon: Code2, color: "text-yellow-400" },
  css: { icon: Hash, color: "text-blue-400" },
  scss: { icon: Hash, color: "text-pink-400" },
  html: { icon: Globe, color: "text-orange-500" },
  json: { icon: FileJson, color: "text-yellow-500" },
  md: { icon: FileText, color: "text-blue-300" },
  png: { icon: FileImage, color: "text-purple-400" },
  jpg: { icon: FileImage, color: "text-purple-400" },
  jpeg: { icon: FileImage, color: "text-purple-400" },
  svg: { icon: FileImage, color: "text-orange-400" },
  sql: { icon: Database, color: "text-pink-500" },
  py: { icon: FileCode, color: "text-blue-500" }, // Python blue/yellow usually, stick to blue
  rs: { icon: Settings, color: "text-orange-600" }, // Rust
  go: { icon: Box, color: "text-cyan-500" },
};

function Scale(props: React.ComponentProps<typeof FileText>) {
    return <FileText {...props} />; // Fallback since Scale isn't imported potentially or I missed it.
}

export function FileIcon({ name, isFolder, isOpen, size = "w-4 h-4", className }: { name: string; isFolder: boolean; isOpen?: boolean; size?: string; className?: string }) {
  if (isFolder) {
    // Folder icons - can be customized further based on folder name (e.g. 'src', 'components')
    // For now standard blue folder
    return (
      <div className={cn(size, className, "relative")}>
         {/* We can use an SVG or Lucide. Lucide Folder/FolderOpen are good. */}
         {/* VS Code uses a flat color. Let's use a nice blue. */}
         {isOpen ? (
            <FolderOpenIcon className={cn(size, className, "text-blue-500 fill-blue-500/20")} />
         ) : (
            <FolderIcon className={cn(size, className, "text-blue-500 fill-blue-500/20")} />
         )}
      </div>
    );
  }

  const exact = FILE_ICONS[name];
  if (exact) {
    const Icon = exact.icon;
    return <Icon className={cn(size, className, exact.color)} />;
  }

  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()?.toLowerCase() : "";
  const match = ext ? EXT_ICONS[ext] : null;

  if (match) {
    const Icon = match.icon;
    return <Icon className={cn(size, className, match.color)} />;
  }

  // Default file
  return <File className={cn(size, className, "text-zinc-400")} />;
}
const FolderIcon = Folder;
const FolderOpenIcon = FolderOpen;
