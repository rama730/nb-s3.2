"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronRight, File as FileIcon, Folder as FolderIcon, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// --- Types ---
type GitStatus = "modified" | "untracked" | "deleted" | "ignored" | null;

interface FolderItemProps extends React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item> {
    value: string;
}

interface FileItemProps extends React.ComponentPropsWithoutRef<"div"> {
    gitStatus?: GitStatus;
    icon?: React.ElementType;
    actions?: React.ReactNode;
}

interface FolderTriggerProps extends React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> {
    gitStatus?: GitStatus;
    actions?: React.ReactNode;
}

// --- Components ---

const Files = React.forwardRef<
    React.ElementRef<typeof AccordionPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>
>(({ className, type = "multiple", ...props }, ref) => (
    <AccordionPrimitive.Root
        ref={ref}
        type={type as any}
        className={cn("w-full space-y-1 font-mono text-sm", className)}
        {...props}
    />
));
Files.displayName = "Files";

const SubFiles = React.forwardRef<
    React.ElementRef<typeof AccordionPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>
>(({ className, type = "multiple", ...props }, ref) => (
    <AccordionPrimitive.Root
        ref={ref}
        type={type as any}
        className={cn("w-full space-y-1 pl-4 border-l border-zinc-200 dark:border-zinc-800 ml-1.5", className)}
        {...props}
    />
));
SubFiles.displayName = "SubFiles";

const FolderItem = React.forwardRef<
    React.ElementRef<typeof AccordionPrimitive.Item>,
    FolderItemProps
>(({ className, ...props }, ref) => (
    <AccordionPrimitive.Item
        ref={ref}
        className={cn("group", className)}
        {...props}
    />
));
FolderItem.displayName = "FolderItem";

interface FolderTriggerProps extends React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> {
    gitStatus?: GitStatus;
    actions?: React.ReactNode;
}

const FolderTrigger = React.forwardRef<
    React.ElementRef<typeof AccordionPrimitive.Trigger>,
    FolderTriggerProps
>(({ className, children, gitStatus, actions, ...props }, ref) => (
    <AccordionPrimitive.Header className="flex items-center group/header w-full">
        <AccordionPrimitive.Trigger
            ref={ref}
            className={cn(
                "flex flex-1 items-center gap-2 py-1 px-2 rounded-md transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 group-data-[state=open]:text-zinc-900 dark:group-data-[state=open]:text-zinc-100 min-w-0 text-left",
                gitStatus === "modified" && "text-yellow-600 dark:text-yellow-500",
                gitStatus === "untracked" && "text-emerald-600 dark:text-emerald-500",
                className
            )}
            {...props}
        >
            <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90 text-zinc-400" />
            <FolderIcon className="h-4 w-4 shrink-0 group-data-[state=open]:hidden" />
            <FolderOpen className="h-4 w-4 shrink-0 hidden group-data-[state=open]:block" />
            <span className="truncate">{children}</span>
            {gitStatus && (
                <span className={cn(
                    "ml-auto text-[10px] font-bold px-1.5 rounded-sm mr-2",
                    gitStatus === "modified" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-500",
                    gitStatus === "untracked" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500"
                )}>
                    {gitStatus === "modified" ? "M" : "U"}
                </span>
            )}
        </AccordionPrimitive.Trigger>
        {actions && <div className="ml-1 flex-shrink-0 relative z-20">{actions}</div>}
    </AccordionPrimitive.Header>
));
FolderTrigger.displayName = "FolderTrigger";

const FolderContent = React.forwardRef<
    React.ElementRef<typeof AccordionPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content
        ref={ref}
        className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
        {...props}
    >
        <div className={cn("pt-1 pb-2", className)}>{children}</div>
    </AccordionPrimitive.Content>
));
FolderContent.displayName = "FolderContent";

const FileItem = React.forwardRef<
    React.ElementRef<"div">,
    FileItemProps
>(({ className, children, gitStatus, icon: Icon = FileIcon, actions, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "group flex items-center gap-2 py-1 px-2 rounded-md transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-zinc-600 dark:text-zinc-400 pl-8 relative",
            gitStatus === "modified" && "text-yellow-600 dark:text-yellow-500",
            gitStatus === "untracked" && "text-emerald-600 dark:text-emerald-500",
            className
        )}
        {...props}
    >
        <Icon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="truncate flex-1">{children}</span>
        {actions && <div className="ml-1 flex-shrink-0 relative z-20">{actions}</div>}
        {gitStatus && (
            <span className={cn(
                "text-[10px] font-bold px-1.5 rounded-sm",
                gitStatus === "modified" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-500",
                gitStatus === "untracked" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500"
            )}>
                {gitStatus === "modified" ? "M" : "U"}
            </span>
        )}
    </div>
));
FileItem.displayName = "FileItem";

export {
    Files,
    SubFiles,
    FolderItem,
    FolderTrigger,
    FolderContent,
    FileItem,
};
