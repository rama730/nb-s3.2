"use client";

import { memo, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Trash2, Wand2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function ScratchpadMode() {
    const [content, setContent] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-load from local storage
    useEffect(() => {
        const saved = localStorage.getItem("workspace-scratchpad");
        if (saved) setContent(saved);
    }, []);

    // Auto-save to local storage (transient memory)
    useEffect(() => {
        const timer = setTimeout(() => {
            localStorage.setItem("workspace-scratchpad", content);
            if (content) {
                setIsSaving(true);
                setTimeout(() => setIsSaving(false), 1000);
            }
        }, 1000);
        return () => clearTimeout(timer);
    }, [content]);

    const handleClear = () => {
        if (confirm("Clear scratchpad? This cannot be undone.")) {
            setContent("");
            localStorage.removeItem("workspace-scratchpad");
        }
    };

    const handleConvertToTask = () => {
        alert("Feature coming soon: Convert to task - " + content.slice(0, 50) + "...");
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    Quick Capture
                    {isSaving && <span className="text-[10px] text-emerald-500 font-normal lowercase transition-opacity">saving...</span>}
                </h3>

                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Copy to clipboard"
                    >
                        <Copy size={14} />
                    </button>
                    <button
                        onClick={handleClear}
                        className="p-1.5 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                        title="Clear scratchpad"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            <div className="flex-1 relative group">
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Type anything here... notes, ideas, draft messages. It saves automatically."
                    className={cn(
                        "w-full h-full resize-none p-4 rounded-xl",
                        "bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800",
                        "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50",
                        "text-sm font-mono leading-relaxed text-zinc-700 dark:text-zinc-300",
                        "placeholder:text-zinc-400 placeholder:font-sans"
                    )}
                />

                {/* Floating Action Button */}
                {content.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute bottom-4 right-4 flex gap-2"
                    >
                        <button
                            onClick={handleConvertToTask}
                            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-indigo-700 transition-all active:scale-95 text-xs font-semibold"
                        >
                            <Wand2 size={14} />
                            Convert to Task
                        </button>
                    </motion.div>
                )}
            </div>

            <div className="mt-4 text-center">
                <p className="text-[10px] text-zinc-400">
                    Content persists locally. Clear daily for best focus.
                </p>
            </div>
        </div>
    );
}

export default memo(ScratchpadMode);
