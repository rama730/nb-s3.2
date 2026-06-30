"use client";

import { useState, useEffect, useCallback } from "react";
import { cacheManager } from "@/lib/utils/cache-manager";
import { toast } from "sonner";
import { Trash2, HardDrive, ShieldAlert } from "lucide-react";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";

export default function CacheSettingsSection() {
  const [totalSize, setTotalSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setTotalSize(estimate.usage || 0);
      } else {
        setTotalSize(0);
      }
    } catch (err) {
      console.error("Failed to load storage data", err);
      setTotalSize(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await cacheManager.clearAll();
      toast.success("Cache and local storage cleared successfully. Refreshing...");
      setShowConfirm(false);
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      toast.error("Failed to clear cache");
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
    <SettingsSectionCard
      title="Cache Management"
      description="Manage local storage data, offline drafts, and assets stored on your device."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Total Cached Space
              </p>
              <p className="text-xs text-zinc-500">
                {loading ? "Calculating space..." : `${formatBytes(totalSize || 0)} stored on this device`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={loading || isClearing}
            className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 dark:bg-red-950/20 dark:hover:bg-red-900/20 dark:text-red-400 dark:border-red-900/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove Cache
          </button>
        </div>

        {showConfirm && (
          <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex gap-4">
              <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 shrink-0 h-fit">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Are you sure you want to clear the cache?
                </p>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                  This will remove all locally stored data, assets, offline message drafts, and database indices. Your active session key will be preserved, but the application will restart to download fresh assets.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleClearAll}
                disabled={isClearing}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all"
              >
                {isClearing ? "Clearing..." : "Confirm & Clear"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
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
