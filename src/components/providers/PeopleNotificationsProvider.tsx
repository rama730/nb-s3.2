"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuthContext } from "@/components/providers/AuthProvider";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { logger } from "@/lib/logger";

interface PeopleNotificationsContextValue {
  totalPending: number;
  pendingConnections: number;
  pendingInvites: number;
  refresh: () => Promise<void>;
}

const PeopleNotificationsContext = createContext<PeopleNotificationsContextValue>({
  totalPending: 0,
  pendingConnections: 0,
  pendingInvites: 0,
  refresh: async () => {},
});

const MAX_RETRY_DELAY_MS = 30_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function getPeopleNotificationsRetryDelay(attempt: number) {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(
    MAX_RETRY_DELAY_MS,
    INITIAL_RETRY_DELAY_MS * 2 ** (safeAttempt - 1),
  );
}

export function PeopleNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const { subscribeUserNotifications } = useRealtime();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const userId = user?.id ?? null;

  const [pendingConnections, setPendingConnections] = useState(0);
  const [pendingInvites] = useState(0);

  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const setIdleState = useCallback(() => {
    clearRetryTimer();
    retryAttemptRef.current = 0;
    setPendingConnections(0);
  }, [clearRetryTimer]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setIdleState();
      return;
    }

    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const runRefresh = (async () => {
      try {
        const { count, error } = await supabase
          .from("connections")
          .select("id", { count: "exact", head: true })
          .eq("addressee_id", userId)
          .eq("status", "pending");

        if (error) {
          throw error;
        }

        clearRetryTimer();
        retryAttemptRef.current = 0;
        setPendingConnections(count || 0);
      } catch (error) {
        retryAttemptRef.current += 1;
        const delayMs = getPeopleNotificationsRetryDelay(retryAttemptRef.current);

        logger.warn("people.notifications.refresh_failed", {
          module: "people",
          userId,
          attempt: retryAttemptRef.current,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });

        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void refresh();
        }, delayMs);
      }
    })();

    refreshPromiseRef.current = runRefresh;
    try {
      await runRefresh;
    } finally {
      if (refreshPromiseRef.current === runRefresh) {
        refreshPromiseRef.current = null;
      }
    }
  }, [clearRetryTimer, setIdleState, supabase, userId]);

  useEffect(() => {
    let idleHandle: number | null = null;
    const idleWindow = window as IdleWindow;

    if (!userId) {
      setIdleState();
      return;
    }

    retryAttemptRef.current = 0;

    const scheduleRefresh = () => {
      void refresh();
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleHandle = idleWindow.requestIdleCallback(() => {
        idleHandle = null;
        scheduleRefresh();
      }, { timeout: 1500 });
    } else {
      idleHandle = window.setTimeout(() => {
        idleHandle = null;
        scheduleRefresh();
      }, 300);
    }

    return () => {
      if (idleHandle !== null) {
        if (typeof idleWindow.requestIdleCallback === "function") {
          idleWindow.cancelIdleCallback(idleHandle);
        } else {
          clearTimeout(idleHandle);
        }
      }
      clearRetryTimer();
    };
  }, [clearRetryTimer, refresh, setIdleState, userId]);

  useEffect(() => {
    if (!userId) return;

    return subscribeUserNotifications((event) => {
      if (event.kind !== "connection") return;
      retryAttemptRef.current = 0;
      clearRetryTimer();
      void refresh();
    });
  }, [clearRetryTimer, refresh, subscribeUserNotifications, userId]);

  const value = useMemo<PeopleNotificationsContextValue>(
    () => ({
      totalPending: pendingConnections + pendingInvites,
      pendingConnections,
      pendingInvites,
      refresh,
    }),
    [pendingConnections, pendingInvites, refresh],
  );

  return (
    <PeopleNotificationsContext.Provider value={value}>
      {children}
    </PeopleNotificationsContext.Provider>
  );
}

export function usePeopleNotificationsContext() {
  return useContext(PeopleNotificationsContext);
}
