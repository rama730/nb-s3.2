"use client";

import { useCallback, useMemo, useState } from "react";
import type React from "react";
import type { PaneId } from "../state/filesTabTypes";

interface UseWorkspaceLayoutStateOptions {
  projectId: string;
  splitEnabled: boolean;
  splitRatio: number;
  leftOpenTabIds: string[];
  rightOpenTabIds: string[];
  setSplitRatio: (projectId: string, ratio: number) => void;
}

export function useWorkspaceLayoutState({
  projectId,
  splitEnabled,
  splitRatio,
  leftOpenTabIds,
  rightOpenTabIds,
  setSplitRatio,
}: UseWorkspaceLayoutStateOptions) {
  const [activePane, setActivePane] = useState<PaneId>("left");

  const panesToRender = useMemo<PaneId[]>(
    () => (splitEnabled ? ["left", "right"] : ["left"]),
    [splitEnabled]
  );

  const leftOpenTabIdsKey = useMemo(() => leftOpenTabIds.join(","), [leftOpenTabIds]);
  const rightOpenTabIdsKey = useMemo(() => rightOpenTabIds.join(","), [rightOpenTabIds]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (!splitEnabled) return;
      e.preventDefault();
      const startX = e.clientX;
      const startRatio = splitRatio;
      const container = (e.currentTarget as HTMLElement).parentElement;
      const width = container?.getBoundingClientRect().width || 1;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setSplitRatio(projectId, startRatio + delta / width);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [projectId, setSplitRatio, splitEnabled, splitRatio]
  );

  return {
    activePane,
    setActivePane,
    panesToRender,
    leftOpenTabIdsKey,
    rightOpenTabIdsKey,
    startResize,
  };
}
