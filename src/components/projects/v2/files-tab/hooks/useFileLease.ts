"use client";

import * as React from "react";

import {
  acquireBrowserFileLease,
  BrowserFileLeaseError,
  releaseBrowserFileLease,
  renewBrowserFileLease,
  type BrowserFileLease,
  type FileLeaseView,
} from "@/lib/files/file-lease-client";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

export type FileLeaseStatus = "idle" | "acquiring" | "owned" | "renewing" | "conflict" | "lost";

export function useFileLease(projectId: string, nodeId: string) {
  const [lease, setLease] = React.useState<BrowserFileLease | null>(null);
  const [status, setStatus] = React.useState<FileLeaseStatus>("idle");
  const [conflict, setConflict] = React.useState<FileLeaseView | null>(null);
  const leaseRef = React.useRef<BrowserFileLease | null>(null);
  const setLocks = useFilesWorkspaceStore((state) => state.setLocks);

  const publishLock = React.useCallback((next: FileLeaseView | null) => {
    const targetNodeId = next?.nodeId ?? nodeId;
    const currentLocks = Object.values(
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.locksByNodeId ?? {},
    ).filter((lock) => lock.nodeId !== targetNodeId);
    setLocks(projectId, next ? [...currentLocks, next] : currentLocks);
  }, [nodeId, projectId, setLocks]);

  const publishLease = React.useCallback((next: BrowserFileLease | null) => {
    leaseRef.current = next;
    setLease(next);
    if (next) {
      publishLock(next);
    }
  }, [publishLock]);

  const acquire = React.useCallback(async () => {
    if (leaseRef.current) return leaseRef.current;
    setStatus("acquiring");
    setConflict(null);
    try {
      const next = await acquireBrowserFileLease(projectId, nodeId);
      publishLease(next);
      setStatus("owned");
      return next;
    } catch (error) {
      const locked = error instanceof BrowserFileLeaseError ? error.lock : null;
      if (locked) {
        setConflict(locked);
        publishLock(locked);
        setStatus("conflict");
      } else {
        setStatus("lost");
      }
      throw error;
    }
  }, [nodeId, projectId, publishLease, publishLock]);

  const renew = React.useCallback(async () => {
    const current = leaseRef.current;
    if (!current) return null;
    setStatus("renewing");
    try {
      const next = await renewBrowserFileLease(current);
      publishLease(next);
      setStatus("owned");
      return next;
    } catch (error) {
      publishLease(null);
      publishLock(null);
      setStatus("lost");
      throw error;
    }
  }, [publishLease, publishLock]);

  const release = React.useCallback(async (keepalive = false) => {
    const current = leaseRef.current;
    publishLease(null);
    setConflict(null);
    setStatus("idle");
    publishLock(null);
    if (!current) return;
    await releaseBrowserFileLease(current, { keepalive }).catch(() => null);
  }, [publishLease, publishLock]);

  React.useEffect(() => {
    if (!lease) return;
    const delay = 32_000 + Math.floor(Math.random() * 6_000);
    const timer = window.setInterval(() => void renew().catch(() => null), delay);
    const onFocus = () => void renew().catch(() => null);
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lease, renew]);

  React.useEffect(() => {
    return () => {
      const current = leaseRef.current;
      if (current) {
        void releaseBrowserFileLease(current, { keepalive: true }).catch(() => null);
      }
    };
  }, []);

  return { lease, status, conflict, acquire, renew, release };
}
