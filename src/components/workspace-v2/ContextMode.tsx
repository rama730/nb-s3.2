"use client";

import { memo, useState, useEffect } from "react";
import { usePathname, useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import {
    Folder,
    FileText,
    GitBranch,
    Calendar,
    ExternalLink,
    Info as InfoIcon
} from "lucide-react";

interface ContextItem {
    id: string;
    name: string;
    type: string;
    date?: string;
    url?: string;
}

function ContextMode() {
    const pathname = usePathname();
    const params = useParams();
    const supabase = createSupabaseBrowserClient();

    const [contextTitle, setContextTitle] = useState("General Context");
    const [files, setFiles] = useState<ContextItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        async function loadContext() {
            setLoading(true);

            // 1. Project Context
            if (pathname?.includes("/projects/") && params?.id) {
                const projectId = params.id as string;

                // Fetch project details
                const { data: project } = await supabase
                    .from("projects")
                    .select("title")
                    .eq("id", projectId)
                    .single();

                if (project) setContextTitle(project.title);

                // Fetch recent files (if table exists)
                try {
                    const { data: projectFiles } = await supabase
                        .from("project_files")
                        .select("id, name, file_type, created_at, url")
                        .eq("project_id", projectId)
                        .order("created_at", { ascending: false })
                        .limit(5);

                    if (projectFiles) {
                        setFiles(projectFiles.map((f: any) => ({
                            id: f.id,
                            name: f.name,
                            type: f.file_type,
                            date: new Date(f.created_at).toLocaleDateString(),
                            url: f.url
                        })));
                    }
                } catch {
                    // Table might not exist
                    setFiles([]);
                }
            }
            // 2. Hub Context
            else if (pathname === "/hub") {
                setContextTitle("Hub");
                setFiles([]);
            }
            // 3. Messages Context
            else if (pathname?.includes("/messages")) {
                setContextTitle("Messages");
                setFiles([]);
            }
            // 4. Default
            else {
                setContextTitle("General");
                setFiles([]);
            }

            setLoading(false);
        }

        loadContext();
    }, [pathname, params, supabase]);

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                    <GitBranch size={18} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">
                        {contextTitle}
                    </h3>
                    <p className="text-xs text-zinc-500 font-mono truncate max-w-[200px]">
                        {pathname}
                    </p>
                </div>
            </div>

            {/* Suggested Files */}
            <section>
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <FileText size={12} />
                    Related Files
                </h4>

                {loading ? (
                    <div className="space-y-2 opacity-50">
                        <div className="h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
                        <div className="h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
                    </div>
                ) : files.length > 0 ? (
                    <div className="space-y-2">
                        {files.map((file, i) => (
                            <motion.div
                                key={file.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="flex items-center gap-3 p-3 bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer transition-colors group"
                                onClick={() => file.url && window.open(file.url, '_blank')}
                            >
                                <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-700 rounded-lg flex items-center justify-center text-zinc-500">
                                    <Folder size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                        {file.name}
                                    </p>
                                    <p className="text-[10px] text-zinc-400">
                                        {file.date} • {file.type}
                                    </p>
                                </div>
                                <ExternalLink size={14} className="text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </motion.div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                        <p className="text-xs">No related files found</p>
                    </div>
                )}
            </section>

            {/* Upcoming Events (Placeholder) */}
            <section>
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Calendar size={12} />
                    Coming Up
                </h4>
                <div className="p-4 bg-gradient-to-r from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl">
                    <div className="flex items-center gap-3 text-zinc-500 text-sm italic">
                        <InfoIcon size={16} />
                        <span>Calendar integration coming soon</span>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default memo(ContextMode);
