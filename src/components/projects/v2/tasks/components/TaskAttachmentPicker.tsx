import React from "react";
import { X } from "lucide-react";
import FileExplorer from "../../explorer/FileExplorer";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { ProjectNode } from "@/lib/db/schema";

interface TaskAttachmentPickerProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    projectName?: string;
    canEdit?: boolean;
    attachments: ProjectNode[];
    setAttachments: (attachments: ProjectNode[]) => void;
}

export default function TaskAttachmentPicker({
    isOpen,
    onClose,
    projectId,
    projectName,
    canEdit = true,
    attachments,
    setAttachments
}: TaskAttachmentPickerProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4">
             {/* Inner Backdrop */}
            <div 
                className="fixed inset-0 bg-black/40 backdrop-blur-sm" 
                onClick={onClose}
            />
            
            {/* Inner Content */}
            <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Select Attachments</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Choose one or more files/folders. Selected: {attachments.length}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
                        <X className="w-4 h-4 text-zinc-500" />
                    </button>
                </div>
                <div className="h-[400px] bg-zinc-50 dark:bg-zinc-900/50">
                    <FileExplorer 
                        projectId={projectId}
                        projectName={projectName}
                        canEdit={canEdit} 
                        onOpenFile={() => {}} 
                        mode="select"
                        selectedNodeIds={attachments.map(a => a.id)}
                        onSelectionChange={(ids: string[]) => {
                            const state = useFilesWorkspaceStore.getState();
                            const nodesById = state.byProjectId[projectId]?.nodesById || {};
                            const existingById = new Map(attachments.map((node) => [node.id, node]));
                            const newAttachments = ids
                                .map((id: string) => nodesById[id] || existingById.get(id))
                                .filter(Boolean) as ProjectNode[];
                            setAttachments(newAttachments);
                        }}
                    />
                </div>
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                     <button 
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                        Done
                    </button>
                </div>
            </div>
         </div>
    );
}
