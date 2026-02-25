"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui-custom/Toast";
import { getProjectSyncStatus, retryGithubImportAction } from "@/app/actions/project";
import { useRouter } from "next/navigation";

interface WorkspaceSyncOverlayProps {
  projectId: string;
  initialSyncStatus: "pending" | "cloning" | "indexing" | "ready" | "failed";
  importSourceType?: "github" | "upload" | "scratch" | null;
  canEdit: boolean;
  onSyncStateChange?: (state: "pending" | "cloning" | "indexing" | "ready" | "failed") => void;
}

function normalizeSyncStatus(
  status: string | null | undefined
): "pending" | "cloning" | "indexing" | "ready" | "failed" {
  if (
    status === "pending" ||
    status === "cloning" ||
    status === "indexing" ||
    status === "ready" ||
    status === "failed"
  ) {
    return status;
  }
  return "pending";
}

export default function WorkspaceSyncOverlay({
  projectId,
  initialSyncStatus,
  importSourceType,
  canEdit,
  onSyncStateChange,
}: WorkspaceSyncOverlayProps) {
  const { showToast } = useToast();
  const router = useRouter();

  const [syncState, setSyncState] = useState(normalizeSyncStatus(initialSyncStatus));
  const showOverlay = syncState !== "ready";
  const [syncPollError, setSyncPollError] = useState<string | null>(null);
  const [syncErrorReason, setSyncErrorReason] = useState<string | null>(null);
  const [retryLoading, setRetryLoading] = useState(false);
  const overlayStartedAtRef = useRef<number | null>(showOverlay ? Date.now() : null);
  const pollDelayRef = useRef<number>(3000);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSyncStateChange?.(syncState);
  }, [syncState, onSyncStateChange]);

  useEffect(() => {
    let cancelled = false;

    const isVisible = () =>
      typeof document === "undefined" ? true : document.visibilityState === "visible";

    const clearTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      pollTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        if (!isVisible()) {
          pollDelayRef.current = Math.min(60_000, Math.max(5_000, pollDelayRef.current * 2));
          schedule(pollDelayRef.current);
          return;
        }

        try {
          const res = await getProjectSyncStatus(projectId);
          if (!res.success) {
            setSyncPollError(res.error || "Unable to check sync status. Retrying...");
            pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
            return;
          }
          if (res.success && res.status) {
            const normalizedStatus = normalizeSyncStatus(res.status);
            if (normalizedStatus !== syncState) {
              pollDelayRef.current = 3000;
              setSyncState(normalizedStatus);
              if (normalizedStatus === "ready") {
                router.refresh();
              }
            } else {
              pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
            }
            if (res.lastError) setSyncErrorReason(res.lastError);
            setSyncPollError(null);
          }
        } catch {
          setSyncPollError("Unable to check sync status. Retrying...");
          pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
        } finally {
          if (!cancelled && syncState !== "ready" && syncState !== "failed") {
            schedule(pollDelayRef.current);
          }
        }
      }, delayMs);
    };

    if (syncState === "ready" || syncState === "failed") {
      overlayStartedAtRef.current = null;
      pollDelayRef.current = 3000;
      clearTimer();
      setSyncPollError(null);
      if (syncState === "failed" && !syncErrorReason) {
        getProjectSyncStatus(projectId).then((res) => {
          if (res.success && res.lastError) setSyncErrorReason(res.lastError);
        });
      }
      return () => {
        cancelled = true;
        clearTimer();
      };
    }

    if (!overlayStartedAtRef.current) overlayStartedAtRef.current = Date.now();
    schedule(0);

    const onVisibility = () => {
      if (isVisible()) {
        pollDelayRef.current = 3000;
        schedule(0);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      clearTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [projectId, syncState, router, syncErrorReason]);

  const handleManualRefresh = useCallback(async () => {
    setRetryLoading(true);
    pollDelayRef.current = 3000;
    try {
      const res = await getProjectSyncStatus(projectId);
      if (res.success && res.status) {
        const normalizedStatus = normalizeSyncStatus(res.status);
        setSyncState(normalizedStatus);
        if (res.lastError) setSyncErrorReason(res.lastError);
        if (normalizedStatus === "ready") {
          router.refresh();
          showToast("Project is ready!", "success");
        } else {
          showToast(`Current status: ${normalizedStatus}`, "info");
        }
      }
    } finally {
      setRetryLoading(false);
    }
  }, [projectId, showToast, router]);

  const elapsedMs = overlayStartedAtRef.current ? Date.now() - overlayStartedAtRef.current : 0;
  const isSlow = elapsedMs > 90_000 && syncState !== "ready" && syncState !== "failed";
  const canRetryImport = importSourceType === "github" && canEdit;

  const handleRetryImport = useCallback(async () => {
    if (!canRetryImport) return;
    setRetryLoading(true);
    pollDelayRef.current = 3000;
    try {
      const res = await retryGithubImportAction(projectId);
      if (!res.success) {
        showToast(res.error || "Retry failed", "error");
        return;
      }
      setSyncState("pending");
      setSyncPollError(null);
      overlayStartedAtRef.current = Date.now();
      showToast("Import retry started", "success");
    } finally {
      setRetryLoading(false);
    }
  }, [canRetryImport, projectId, showToast]);

  if (!showOverlay) return null;

  return (
    <div className="absolute inset-0 z-50 bg-white/95 dark:bg-zinc-950/95 flex flex-col items-center justify-center p-8 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="flex flex-col items-center max-w-md text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center relative">
          {syncState === "failed" ? (
            <RefreshCw className="w-10 h-10 text-red-500" />
          ) : (
            <>
              <div className="absolute inset-0 rounded-2xl border-2 border-indigo-500/20 animate-ping" />
              <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
            </>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {syncState === "cloning"
              ? "Importing Repository..."
              : syncState === "indexing"
                ? "Indexing Files..."
                : syncState === "pending"
                  ? "Queued for Import..."
                  : "Import Failed"}
          </h3>
          <p className="text-zinc-500 dark:text-zinc-400">
            {syncState === "failed"
              ? syncErrorReason ||
                "We couldn't import your project. Please try again or check the repository URL."
              : "We're setting up your workspace. This usually takes less than a minute."}
          </p>
          {syncPollError && (
            <p className="text-xs text-red-600 dark:text-red-400">{syncPollError}</p>
          )}
          {isSlow && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Taking longer than usual? Try refreshing the status.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          {syncState === "failed" || isSlow ? (
            canRetryImport ? (
              <Button onClick={handleRetryImport} disabled={retryLoading} className="w-full">
                {retryLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Retry GitHub Import
              </Button>
            ) : (
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="w-full"
              >
                Reload Page
              </Button>
            )
          ) : null}

          {syncState !== "failed" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualRefresh}
              disabled={retryLoading}
              className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {retryLoading ? "Checking..." : "Check Status Again"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export { type WorkspaceSyncOverlayProps };
