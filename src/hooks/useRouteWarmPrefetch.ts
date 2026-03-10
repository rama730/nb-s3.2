"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

const ROUTE_PREFETCH_TTL_MS = 45_000;
const ROUTE_PREFETCH_MAX_KEYS = 256;
const warmedRouteMap = new Map<string, number>();

function normalizeRouteTarget(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith("/")) return null;
  const withoutHash = trimmed.split("#")[0] || trimmed;
  return withoutHash;
}

function shouldWarmRoute(route: string): boolean {
  const now = Date.now();
  const previous = warmedRouteMap.get(route);
  if (typeof previous === "number" && now - previous < ROUTE_PREFETCH_TTL_MS) {
    return false;
  }

  if (warmedRouteMap.size >= ROUTE_PREFETCH_MAX_KEYS) {
    const oldest = warmedRouteMap.keys().next().value;
    if (oldest) warmedRouteMap.delete(oldest);
  }

  warmedRouteMap.set(route, now);
  return true;
}

export function useRouteWarmPrefetch() {
  const router = useRouter();

  return useCallback(
    (href: string) => {
      const route = normalizeRouteTarget(href);
      if (!route) return;
      if (!shouldWarmRoute(route)) return;
      router.prefetch(route);
    },
    [router]
  );
}

