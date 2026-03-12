'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { logger } from '@/lib/logger';
import {
  classifyRouteRenderingMode,
  getRouteCachePolicy,
  resolveRouteContract,
} from '@/lib/performance/page-contract';

function getLatestNavigationTiming(): PerformanceNavigationTiming | null {
  const entries = performance.getEntriesByType('navigation');
  if (!entries || entries.length === 0) return null;
  return entries[entries.length - 1] as PerformanceNavigationTiming;
}

export function RoutePerformanceObserver() {
  const pathname = usePathname();
  const lastNavSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const nav = getLatestNavigationTiming();
    if (!nav) return;

    const navSignature = `${Math.round(nav.startTime)}:${Math.round(nav.responseStart)}:${Math.round(nav.loadEventEnd)}`;
    if (lastNavSignatureRef.current === navSignature) return;
    lastNavSignatureRef.current = navSignature;

    const routeContract = resolveRouteContract(pathname || '/');
    const routeId = routeContract?.routeId ?? (pathname || '/');
    const isAuthenticated = document.cookie
      .toLowerCase()
      .split(';')
      .some((part) => part.includes('sb-') && part.includes('auth-token'));
    const cachePolicy = getRouteCachePolicy(routeId, { isAuthenticated });
    const renderingMode = classifyRouteRenderingMode(routeId);

    const ttfbMs = Math.max(0, nav.responseStart - nav.requestStart);
    const loadMs = Math.max(0, nav.loadEventEnd - nav.startTime);
    const hydrationMs = Math.max(0, nav.domContentLoadedEventEnd - nav.responseEnd);

    logger.metric('route.server.ttfb', {
      routeId,
      path: pathname,
      valueMs: Math.round(ttfbMs),
      navType: nav.type,
      cacheStrategy: cachePolicy.strategy,
      renderingMode,
    });
    logger.metric('route.browser.load', {
      routeId,
      path: pathname,
      valueMs: Math.round(loadMs),
      navType: nav.type,
      cacheStrategy: cachePolicy.strategy,
      renderingMode,
    });
    logger.metric('route.hydration.ms', {
      routeId,
      path: pathname,
      valueMs: Math.round(hydrationMs),
      navType: nav.type,
      cacheStrategy: cachePolicy.strategy,
      renderingMode,
    });
  }, [pathname]);

  return null;
}
