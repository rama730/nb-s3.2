"use client";

import React, { useState, useEffect, useRef } from "react";
import { Edit2, Eye, CheckCircle, Save, HelpCircle, Copy, ChevronUp, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const LOCAL_STORAGE_KEY = "edge:workspace:notes:v1";

export default function WorkspaceNotesTab() {
    const [note, setNote] = useState("");
    const [mode, setMode] = useState<"edit" | "preview">("edit");
    const [isSaving, setIsSaving] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Focus textarea on expand
    useEffect(() => {
        if (isExpanded && textareaRef.current && mode === "edit") {
            textareaRef.current.focus();
        }
    }, [isExpanded, mode]);

    // Initial load
    useEffect(() => {
        if (typeof window !== "undefined") {
            const savedNote = window.localStorage.getItem(LOCAL_STORAGE_KEY) || "";
            setNote(savedNote);
        }
    }, []);

    // Debounced auto-save
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setNote(val);
        setIsSaving(true);

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            if (typeof window !== "undefined") {
                window.localStorage.setItem(LOCAL_STORAGE_KEY, val);
            }
            setIsSaving(false);
        }, 800);
    };

    // Auto-resize textarea to fit content length
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea && mode === "edit") {
            textarea.style.height = "auto";
            textarea.style.height = `${Math.max(160, textarea.scrollHeight)}px`;
        }
    }, [note, mode]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    const insertMarkdown = (syntax: "bold" | "italic" | "code" | "list") => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        let prefix = "";
        let suffix = "";
        
        if (syntax === "bold") {
            prefix = "**";
            suffix = "**";
        } else if (syntax === "italic") {
            prefix = "*";
            suffix = "*";
        } else if (syntax === "code") {
            prefix = "`";
            suffix = "`";
        } else if (syntax === "list") {
            prefix = "\n- ";
            suffix = "";
        }

        const selectedText = text.substring(start, end);
        const replacement = prefix + (selectedText || "text") + suffix;
        const newVal = text.substring(0, start) + replacement + text.substring(end);

        setNote(newVal);
        setIsSaving(true);
        
        if (typeof window !== "undefined") {
            window.localStorage.setItem(LOCAL_STORAGE_KEY, newVal);
            setTimeout(() => setIsSaving(false), 300);
        }

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selectedText || "text").length);
        }, 0);
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(note);
        toast.success("Notes copied to clipboard!");
    };

    return (
        <motion.div
            layout
            initial={false}
            animate={{ height: isExpanded ? 280 : 44 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={() => {
                if (!isExpanded) {
                    setIsExpanded(true);
                    setMode("edit");
                }
            }}
            className={cn(
                "flex flex-col w-full bg-zinc-50/50 dark:bg-zinc-900/10 rounded-2xl border overflow-hidden",
                isExpanded
                    ? "border-zinc-300 dark:border-zinc-700 shadow-sm cursor-default"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer"
            )}
        >
            {!isExpanded ? (
                <div className="flex items-center justify-between w-full h-full px-4 text-xs select-none">
                    <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 min-w-0 flex-1">
                        <Edit2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="font-semibold text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                            Scratchpad
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-700 shrink-0">|</span>
                        <span className="text-zinc-500 dark:text-zinc-400 truncate text-[11px] font-medium min-w-0">
                            {note.trim() ? note.split('\n')[0] : "Write a note... (markdown supported)"}
                        </span>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                </div>
            ) : (
                <div className="flex flex-col h-full min-h-0 w-full">
                    {/* Toolbar Header */}
                    <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
                        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1">
                            <button
                                type="button"
                                onClick={() => setMode("edit")}
                                className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                                    mode === "edit"
                                        ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                            >
                                <Edit2 className="w-3 h-3" />
                                Edit
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode("preview")}
                                className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                                    mode === "preview"
                                        ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                            >
                                <Eye className="w-3 h-3" />
                                Preview
                            </button>

                            {mode === "edit" && (
                                <div className="flex items-center gap-2 border-l border-zinc-200 dark:border-zinc-800/80 pl-2.5 ml-2.5">
                                    <button
                                        type="button"
                                        onClick={() => insertMarkdown("bold")}
                                        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[10px] font-extrabold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                        title="Bold"
                                    >
                                        B
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertMarkdown("italic")}
                                        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[10px] italic text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                        title="Italic"
                                    >
                                        I
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertMarkdown("code")}
                                        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[9px] font-mono text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                        title="Code"
                                    >
                                        &lt;&gt;
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertMarkdown("list")}
                                        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                        title="List"
                                    >
                                        • List
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Status & Clipboard Actions */}
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">
                                {isSaving ? (
                                    <>
                                        <Save className="w-2.5 h-2.5 animate-pulse text-blue-500" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-2.5 h-2.5 text-emerald-500" />
                                        <span>Saved</span>
                                    </>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard();
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 rounded transition-colors"
                                title="Copy to Clipboard"
                            >
                                <Copy className="w-3 h-3" />
                                Copy
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded(false);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 text-[10px] font-bold text-blue-600 dark:text-blue-400 rounded transition-colors"
                                title="Done Editing"
                            >
                                <ChevronUp className="w-3 h-3" />
                                Done
                            </button>
                        </div>
                    </div>

                    {/* Note Canvas View */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-white dark:bg-zinc-950/40">
                        {mode === "edit" ? (
                            <textarea
                                ref={textareaRef}
                                value={note}
                                onChange={handleChange}
                                placeholder="Write down personal notes, scratch ideas, or draft todo tasks using Markdown..."
                                className="w-full h-full resize-none bg-transparent outline-none border-none text-zinc-800 dark:text-zinc-200 text-xs leading-relaxed placeholder-zinc-400 focus:ring-0 focus:outline-none"
                            />
                        ) : note.trim() === "" ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-400">
                                <HelpCircle className="w-6 h-6 opacity-50 mb-2" />
                                <p className="text-xs font-semibold">Nothing to preview yet</p>
                                <p className="text-[10px] text-zinc-500">Go back to edit mode and write some notes.</p>
                            </div>
                        ) : (
                            <article className="prose prose-xs dark:prose-invert max-w-none focus:outline-none leading-relaxed text-zinc-800 dark:text-zinc-300 text-xs">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
                            </article>
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    );
}
