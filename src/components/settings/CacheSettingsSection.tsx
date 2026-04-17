"use client";

import { useState, useEffect, useCallback } from "react";
import { cacheManager, type StorageCategoryUsage } from "@/lib/utils/cache-manager";
import { toast } from "sonner";
import { 
    Trash2, 
    ShieldAlert, 
    RefreshCw, 
    HardDrive, 
    ShieldCheck, 
    FileJson, 
    RotateCw 
} from "lucide-react";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";

export default function CacheSettingsSection() {
    const [estimate, setEstimate] = useState<{ total: number; quota: number; persistent: boolean } | null>(null);
    const [breakdown, setBreakdown] = useState<StorageCategoryUsage[]>([]);
    const [loading, setLoading] = useState(true);
    const [isClearing, setIsClearing] = useState(false);
    const [showConfirm, setShowConfirm] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [est, detailed] = await Promise.all([
                cacheManager.getStorageEstimate(),
                cacheManager.getDetailedBreakdown(),
            ]);
            setEstimate(est);
            setBreakdown(detailed);
        } catch (err) {
            console.error("Failed to load storage data", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleClearStatics = async () => {
        setIsClearing(true);
        try {
            await cacheManager.clearStaticsOnly();
            toast.success("Static assets cleared. App remains responsive.");
            loadData();
            setShowConfirm(null);
        } catch {
            toast.error("Failed to clear static cache");
        } finally {
            setIsClearing(false);
        }
    };

    const handleClearAll = async () => {
        setIsClearing(true);
        try {
            await cacheManager.clearAll();
            toast.success("All local data cleared. Refreshing...");
            setShowConfirm(null);
            window.setTimeout(() => window.location.reload(), 500);
        } catch {
            toast.error("Failed to clear local data");
        } finally {
            setShowConfirm(null);
            setIsClearing(false);
        }
    };

    const handleTogglePersistence = async () => {
        if (estimate?.persistent) {
            toast.info("Storage is already persistent. Browser manages this setting.");
            return;
        }
        const granted = await cacheManager.requestPersistence();
        if (granted) {
            toast.success("Storage successfully hardened against eviction");
            loadData();
        } else {
            toast.error("Browser denied persistence request. Try interacting with the app more.");
        }
    };

    const handleBackup = async () => {
        const json = await cacheManager.backupUserStore();
        if (!json) {
            toast.info("No unsaved drafts or history found on this device.");
            return;
        }
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Local backup downloaded successfully");
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    return (
        <SettingsSectionCard
            title="Cache Management"
            description="Manage how your device stores application data, offline drafts, and assets."
        >
            <div className="space-y-8">
                {/* 1. Storage Health & Persistence */}
                <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl ${estimate?.persistent ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'}`}>
                            {estimate?.persistent ? <ShieldCheck className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {estimate?.persistent ? 'Hardened / Persistent' : 'Best-Effort Storage'}
                            </p>
                            <p className="text-xs text-zinc-500">
                                {estimate?.persistent 
                                    ? 'Browser will not automatically clear this data.' 
                                    : 'Browser may clear this data if device space is low.'}
                            </p>
                        </div>
                    </div>
                    {!estimate?.persistent && (
                        <button 
                            onClick={handleTogglePersistence}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        >
                            Request Persistence
                        </button>
                    )}
                </div>

                {/* 2. Categorized Breakdown */}
                <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Stored Categories</p>
                    <div className="grid grid-cols-1 gap-3">
                        {loading ? (
                            <div className="py-8 flex justify-center"><RotateCw className="h-6 w-6 animate-spin text-zinc-300" /></div>
                        ) : breakdown.map((cat) => (
                            <div key={cat.id} className="group relative flex items-center justify-between p-4 rounded-xl border border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-all">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{cat.label}</span>
                                        {cat.isPrimary && (
                                            <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-[10px] font-bold text-blue-600 uppercase">Primary</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-500 max-w-[320px]">{cat.description}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-mono font-semibold text-zinc-700 dark:text-zinc-300">{formatBytes(cat.size)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Actions Grid */}
                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        onClick={() => setShowConfirm('statics')}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Refresh Static Assets
                    </button>
                    <button
                        onClick={handleBackup}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <FileJson className="h-4 w-4" />
                        Export Snapshot
                    </button>
                </div>

                <div className="flex items-center gap-2 py-2">
                    <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Reset Zone</span>
                    <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
                </div>

                <button
                    onClick={() => setShowConfirm('all')}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 text-sm font-semibold hover:bg-red-100/50 transition-colors"
                >
                    <Trash2 className="h-4 w-4" />
                    Reset All Local Application Data
                </button>

                {/* Modals / Overlays */}
                {showConfirm && (
                    <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex gap-4">
                            <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 shrink-0 h-fit">
                                <ShieldAlert className="h-6 w-6" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                                    {showConfirm === 'statics' ? 'Refresh static cache?' : 'Full application reset?'}
                                </p>
                                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                                    {showConfirm === 'statics' 
                                        ? 'This will safely clear images, fonts, and script chunks. Your unsaved drafts and offline edits will NOT be affected.' 
                                        : 'This is a DESTRUCTIVE action. It will delete ALL local data including offline changes that haven\'t synced. We recommend creating a backup first.'}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={showConfirm === 'statics' ? handleClearStatics : handleClearAll}
                                disabled={isClearing}
                                className={`flex-1 py-2.5 rounded-xl text-white text-xs font-bold transition-all ${showConfirm === 'statics' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}`}
                            >
                                {isClearing ? "Syncing..." : "Confirm & Proceed"}
                            </button>
                            <button
                                onClick={() => setShowConfirm(null)}
                                disabled={isClearing}
                                className="flex-1 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </SettingsSectionCard>
    );
}
