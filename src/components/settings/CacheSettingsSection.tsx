"use client";

import { useState, useEffect } from "react";
import { cacheManager } from "@/lib/utils/cache-manager";
import { toast } from "sonner";
import { Trash2, ShieldAlert, Cpu, Database, RefreshCw } from "lucide-react";

export default function CacheSettingsSection() {
    const [estimate, setEstimate] = useState<{ total: number; quota: number } | null>(null);
    const [isClearing, setIsClearing] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        async function loadEstimate() {
            const data = await cacheManager.getStorageEstimate();
            setEstimate(data);
        }
        loadEstimate();
    }, []);

    const handleClearCache = async () => {
        setIsClearing(true);
        try {
            await cacheManager.clearAll();
            toast.success("Cache cleared successfully");
            // Refresh estimate
            const data = await cacheManager.getStorageEstimate();
            setEstimate(data);
            setShowConfirm(false);
        } catch (error) {
            toast.error("Failed to clear cache");
            console.error(error);
        } finally {
            setIsClearing(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    return (
        <section className="space-y-4">
            <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-zinc-500" />
                <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Cache Management</h2>
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Local Data Usage</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            The application stores temporary data locally to improve performance and enable offline features.
                        </p>
                    </div>
                    {estimate && (
                        <div className="text-right">
                            <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                                {formatBytes(estimate.total)}
                            </span>
                            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">
                                Occupied
                            </p>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <Cpu className="h-4 w-4 text-zinc-400" />
                        <div className="space-y-0.5">
                            <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">In-Memory Caches</p>
                            <p className="text-[10px] text-zinc-500">Profiles, active states</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <RefreshCw className="h-4 w-4 text-zinc-400" />
                        <div className="space-y-0.5">
                            <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Persistence</p>
                            <p className="text-[10px] text-zinc-500">History, filters, IndexedDB</p>
                        </div>
                    </div>
                </div>

                {!showConfirm ? (
                    <button
                        onClick={() => setShowConfirm(true)}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <Trash2 className="h-4 w-4" />
                        Clear Application Cache
                    </button>
                ) : (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-start gap-3">
                            <ShieldAlert className="h-5 w-5 text-amber-600" />
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Are you sure?</p>
                                <ul className="text-xs text-amber-700 dark:text-amber-400/80 list-disc list-inside space-y-1">
                                    <li>Saved drafts and search history will be removed</li>
                                    <li>Offline messages may be cleared</li>
                                    <li>Profiles and metadata will be re-fetched</li>
                                </ul>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleClearCache}
                                disabled={isClearing}
                                className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                                {isClearing ? "Clearing..." : "Yes, Clear Everything"}
                            </button>
                            <button
                                onClick={() => setShowConfirm(false)}
                                disabled={isClearing}
                                className="flex-1 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold transition-colors hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
