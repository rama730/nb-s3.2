"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  SprintTimelineFilter,
  SprintTimelineMode,
  SprintViewPreference,
} from "@/lib/projects/sprint-detail";

function buildSprintPreferenceKey(userId: string | null | undefined, projectId: string) {
  return `sprint-view-preferences:${userId ?? "anon"}:${projectId}`;
}

export function useSprintViewPreferences(
  userId: string | null | undefined,
  projectId: string,
) {
  const storageKey = useMemo(() => buildSprintPreferenceKey(userId, projectId), [projectId, userId]);
  const [persistedPreference, setPersistedPreference] = useState<SprintViewPreference | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setPersistedPreference(null);
        setIsReady(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<{
        mode: SprintTimelineMode;
        filter: SprintTimelineFilter;
      }>;

      if (
        typeof parsed.mode === "string" &&
        typeof parsed.filter === "string"
      ) {
        setPersistedPreference({
          mode: parsed.mode,
          filter: parsed.filter,
        });
        setIsReady(true);
        return;
      }
    } catch {
      // Ignore malformed local preferences.
    }

    setPersistedPreference(null);
    setIsReady(true);
  }, [storageKey]);

  const savePreference = useCallback((preference: SprintViewPreference) => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preference));
      setPersistedPreference(preference);
    } catch {
      // Ignore localStorage failures.
    }
  }, [storageKey]);

  return {
    isReady,
    persistedPreference,
    savePreference,
  };
}
