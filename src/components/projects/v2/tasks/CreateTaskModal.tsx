"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
    X, 
    ChevronDown, 
    Zap, 
    Target, 
    Calendar, 
    User, 
    Plus, 
    Flag, 
    CheckCircle2, 
    HelpCircle,
    Layout,

    Paperclip,
    FileText as FileIcon,
    Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import TaskTemplates from "./TaskTemplates";
import TaskAttachmentPicker from "./components/TaskAttachmentPicker";
import { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";



interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (data: any) => Promise<{ success: boolean; error?: string }>;
    members?: any[]; // For assignee selector
    sprints?: any[]; // For sprint selector
    projectId: string; // Required for file picker and creation
    projectName?: string; // For file picker display
}

export default function CreateTaskModal({ 
    isOpen, 
    onClose, 
    onCreate,
    members = [],
    sprints = [],
    projectId,
    projectName
}: CreateTaskModalProps) {

    // Essential Fields
    const [title, setTitle] = useState("");
    const [sprintId, setSprintId] = useState("");
    // Story points removed
    const [status, setStatus] = useState("todo");

    const [priority, setPriority] = useState("medium");
    const [type, setType] = useState("task");
    const [description, setDescription] = useState("");
    const [assigneeId, setAssigneeId] = useState("");
    const [dueDate, setDueDate] = useState("");

    // Advanced Fields
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [createAnother, setCreateAnother] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Dynamic Lists (Subtasks & Tags & Attachments)
    const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [attachments, setAttachments] = useState<ProjectNode[]>([]);
    const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

    // Reset form when opening
    useEffect(() => {
        if (isOpen) {
            setTitle("");
            setDescription("");
            setSubtasks([]);
            setTags([]);
            setAttachments([]);
            setShowAdvanced(false);
            setIsFilePickerOpen(false);
            setSubmitError(null);
            // Don't reset createAnother as user might want it to persist
        }
    }, [isOpen]);

    const handleCreate = async () => {
        if (!title.trim()) return;

        setIsSubmitting(true);
        setSubmitError(null);
        
        try {
            const taskData = {
                title,
                description,
                sprintId: sprintId || null,
                status,
                priority: priority as any,
                type,
                assigneeId: assigneeId || null,
                dueDate: dueDate || null,
                attachmentIds: attachments.map(a => a.id),
                subtasks: subtasks.map(st => ({ title: st.title, completed: false })),
                projectId
            };

            const result = await onCreate(taskData);
            if (!result.success) {
                setSubmitError(result.error || "Failed to create task");
                return;
            }

            if (!createAnother) {
                onClose();
                return;
            }

            setTitle("");
            setDescription("");
            setSubtasks([]);
            setTags([]);
            setAttachments([]);
            setAssigneeId("");
            setDueDate("");
            setSprintId("");
            setStatus("todo");
            setPriority("medium");
            setType("task");
        } catch (e) {
            console.error(e);
            setSubmitError("Failed to create task");
        } finally {
            setIsSubmitting(false);
        }
    };


    const addSubtask = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        if (input.value.trim()) {
            setSubtasks([...subtasks, { id: crypto.randomUUID(), title: input.value.trim() }]);
            input.value = "";
        }
    };

    const removeSubtask = (id: string) => {
        setSubtasks(subtasks.filter(st => st.id !== id));
    };

    const addTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        const value = input.value.trim();
        if (value && !tags.includes(value)) {
            setTags([...tags, value]);
            input.value = "";
        }
    };

    const removeTag = (tag: string) => {
        setTags(tags.filter(t => t !== tag));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm" 
                onClick={onClose}
            />
            
            {/* Modal Card */}
            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header Section */}
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between flex-shrink-0">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Create New Task
                    </h2>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-500 dark:text-zinc-400 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Content Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="space-y-6">
                        {submitError ? (
                            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                                {submitError}
                            </div>
                        ) : null}

                        {/* Section 1: Sprint & Attachments */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Sprint Selector */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                                    <Zap className="w-3.5 h-3.5 text-indigo-500" />
                                    Sprint
                                </label>
                                <div className="relative">
                                    <select 
                                        value={sprintId}
                                        onChange={(e) => setSprintId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none appearance-none"
                                    >
                                        <option value="">Backlog (no sprint)</option>
                                        {sprints
                                            .filter(s => {
                                                if (!s.endDate) return true;
                                                const endDate = new Date(s.endDate);
                                                const today = new Date();
                                                today.setHours(0, 0, 0, 0); 
                                                return endDate >= today;
                                            })
                                            .map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))
                                        }
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                </div>
                            </div>
                            
                            
                            {/* Attachments Section */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                                    <Paperclip className="w-3.5 h-3.5 text-zinc-500" />
                                    Attachments
                                </label>
                                <div className="space-y-2">
                                    {/* Attachment List */}
                                    {attachments.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {attachments.map((file) => (
                                                <div key={file.id} className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md text-sm border border-zinc-200 dark:border-zinc-700">
                                                    <FileIcon className="w-3.5 h-3.5 text-zinc-500" />
                                                    <span className="max-w-[120px] truncate text-zinc-700 dark:text-zinc-300" title={file.name}>{file.name}</span>
                                                    <button 
                                                        onClick={() => setAttachments(prev => prev.filter(p => p.id !== file.id))}
                                                        className="text-zinc-400 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add Button */}
                                    <button
                                        onClick={() => setIsFilePickerOpen(true)}
                                        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium flex items-center gap-1.5 transition-colors"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Attach files from project
                                    </button>

                                </div>
                            </div>

                        </div>

                        {/* Section 2: Title */}
                        <div>
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Task title"
                                className="w-full text-xl font-semibold bg-transparent border-none placeholder-zinc-300 dark:placeholder-zinc-600 focus:ring-0 focus:outline-none focus:border-none p-0 text-zinc-900 dark:text-zinc-100 shadow-none ring-0 outline-none"
                                autoFocus
                            />
                        </div>

                        {/* Section 3: Type & Priority & Status */}
                        <div className="flex flex-wrap gap-4">
                            {/* Type Selector */}
                            <div className="relative">
                                <select 
                                    value={type}
                                    onChange={(e) => setType(e.target.value)}
                                    className="appearance-none pl-9 pr-8 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                    <option value="task">Task</option>
                                    <option value="bug">Bug</option>
                                    <option value="story">Story</option>
                                </select>
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                    {type === 'bug' ? <HelpCircle className="w-3.5 h-3.5 text-red-500" /> : 
                                     type === 'story' ? <Layout className="w-3.5 h-3.5 text-green-500" /> :
                                     <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />}
                                </div>
                            </div>
                            
                            {/* Priority Selector */}
                            <div className="relative">
                                <select 
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value)}
                                    className="appearance-none pl-9 pr-8 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <Flag className={cn(
                                        "w-3.5 h-3.5",
                                        priority === 'urgent' ? 'text-red-500 fill-red-500' :
                                        priority === 'high' ? 'text-orange-500 fill-orange-500' :
                                        priority === 'medium' ? 'text-yellow-500' : 'text-zinc-400'
                                    )} />
                                </div>
                            </div>

                             {/* Status Selector (Simple) */}
                             <div className="relative">
                                <select 
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value)}
                                    className="appearance-none pl-3 pr-8 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                    <option value="todo">To Do</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="done">Done</option>
                                </select>
                                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Section 4: Description */}
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a short description..."
                            rows={3}
                            className="w-full bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700/50 rounded-lg p-4 resize-none text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                        />

                        {/* Section 5: Assignee & Due Date */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Assignee */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Assignee
                                </label>
                                <div className="relative">
                                    <select 
                                        value={assigneeId}
                                        onChange={(e) => setAssigneeId(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none appearance-none"
                                    >
                                        <option value="">Unassigned</option>
                                        {members.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.fullName || m.full_name || m.name || m.username || 'Member'}
                                            </option>
                                        ))}
                                    </select>
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                </div>
                            </div>
                            
                            {/* Due Date */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Due Date
                                </label>
                                <div className="relative">
                                    <input 
                                        type="date" 
                                        value={dueDate}
                                        onChange={(e) => setDueDate(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" 
                                    />
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {/* Section 6: Advanced Fields Toggle */}
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-sm font-medium text-zinc-600 dark:text-zinc-300"
                        >
                            {showAdvanced ? "Hide advanced fields" : "Add more details"}
                            <ChevronDown className={cn(
                                "w-4 h-4 transition-transform duration-200",
                                showAdvanced ? "rotate-180" : ""
                            )} />
                        </button>

                        <AnimatePresence>
                            {showAdvanced && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden space-y-6"
                                >
                                    <div className="pt-2 space-y-6 pb-2">
                                        {/* Task Templates */}
                                        <div className="p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
                                            <TaskTemplates 
                                                onSelectTemplate={(t) => {
                                                    setTitle(t.title);
                                                }}
                                            />
                                        </div>

                                        {/* Subtasks */}
                                        <div className="space-y-3">
                                            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                                Subtasks
                                            </label>
                                            <div className="space-y-2">
                                                {subtasks.map((st) => (
                                                    <div key={st.id} className="flex items-center gap-3 group">
                                                        <div className="w-4 h-4 rounded border border-zinc-300 dark:border-zinc-600 flex-shrink-0" />
                                                        <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">{st.title}</span>
                                                        <button 
                                                            onClick={() => removeSubtask(st.id)}
                                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-all text-zinc-400 hover:text-red-500"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                                
                                                <div className="flex items-center gap-3">
                                                    <Plus className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                                    <input
                                                        placeholder="Add subtask... (Enter to add)"
                                                        onKeyDown={(e) => e.key === 'Enter' && addSubtask(e)}
                                                        className="flex-1 bg-transparent border-none p-0 text-sm placeholder-zinc-400 focus:ring-0 text-zinc-900 dark:text-zinc-100"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tags */}
                                        <div className="space-y-3">
                                            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                                Tags
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {tags.map(tag => (
                                                    <span key={tag} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                                                        #{tag}
                                                        <button 
                                                            onClick={() => removeTag(tag)}
                                                            className="hover:text-red-500 transition-colors"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </span>
                                                ))}
                                                <input
                                                    placeholder="Add tag... (Enter)"
                                                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && addTag(e)}
                                                    className="bg-transparent border-none p-0 text-sm w-32 placeholder-zinc-400 focus:ring-0 text-zinc-900 dark:text-zinc-100"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Footer Section */}
                <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between gap-3 flex-shrink-0">

                    <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            checked={createAnother}
                            onChange={(e) => setCreateAnother(e.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500 bg-white dark:bg-zinc-800" 
                        />
                        Create & add another
                    </label>
                    <div className="flex items-center justify-end gap-3">
                        <button 
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleCreate}
                            disabled={isSubmitting || !title.trim()}
                            className="px-6 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95"
                        >
                            {isSubmitting ? "Creating..." : "Create Task"}
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* Nested File Picker Dialog */}
            <TaskAttachmentPicker 
                isOpen={isFilePickerOpen}
                onClose={() => setIsFilePickerOpen(false)}
                projectId={projectId}
                projectName={projectName}
                attachments={attachments}
                setAttachments={setAttachments}
            />

        </div>
    );
}
