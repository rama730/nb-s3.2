export type RouteRenderingMode = "static" | "revalidate" | "dynamic";
export type RouteDataClass = "public_cached" | "user_scoped" | "realtime";
export type RouteHydrationBoundary = "minimal" | "standard" | "heavy";
export type RouteCacheStrategy = "swr" | "request" | "none";

export interface PagePerformanceContract {
  routeId: string;
  pageFile: string;
  renderingMode: RouteRenderingMode;
  dataClass: RouteDataClass;
  cacheTtlSeconds: number;
  invalidationOwner: "server-action" | "api" | "realtime" | "none";
  hydrationBoundary: RouteHydrationBoundary;
  maxInitialPayloadKb: number;
  revalidateSeconds?: number;
  allowForceDynamic?: boolean;
}

export interface RouteCachePolicy {
  strategy: RouteCacheStrategy;
  ttlSeconds: number;
  invalidationOwner: PagePerformanceContract["invalidationOwner"];
}

type ViewerContext = {
  isAuthenticated?: boolean;
};

export const PAGE_PERFORMANCE_CONTRACTS: Record<string, PagePerformanceContract> = {
  "/": {
    routeId: "/",
    pageFile: "src/app/page.tsx",
    renderingMode: "static",
    dataClass: "public_cached",
    cacheTtlSeconds: 300,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    maxInitialPayloadKb: 160,
  },
  "/login": {
    routeId: "/login",
    pageFile: "src/app/(auth)/login/page.tsx",
    renderingMode: "static",
    dataClass: "public_cached",
    cacheTtlSeconds: 60,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    maxInitialPayloadKb: 200,
  },
  "/signup": {
    routeId: "/signup",
    pageFile: "src/app/(auth)/signup/page.tsx",
    renderingMode: "static",
    dataClass: "public_cached",
    cacheTtlSeconds: 60,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    maxInitialPayloadKb: 220,
  },
  "/onboarding": {
    routeId: "/onboarding",
    pageFile: "src/app/(onboarding)/onboarding/page.tsx",
    renderingMode: "static",
    dataClass: "user_scoped",
    cacheTtlSeconds: 0,
    invalidationOwner: "server-action",
    hydrationBoundary: "heavy",
    maxInitialPayloadKb: 320,
    allowForceDynamic: false,
  },
  "/hub": {
    routeId: "/hub",
    pageFile: "src/app/(main)/hub/page.tsx",
    renderingMode: "dynamic",
    dataClass: "realtime",
    cacheTtlSeconds: 45,
    invalidationOwner: "realtime",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 260,
    allowForceDynamic: true,
  },
  "/people": {
    routeId: "/people",
    pageFile: "src/app/(main)/people/page.tsx",
    renderingMode: "dynamic",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 260,
    allowForceDynamic: true,
  },
  "/projects/[slug]": {
    routeId: "/projects/[slug]",
    pageFile: "src/app/(main)/projects/[slug]/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 300,
    revalidateSeconds: 60,
  },
  "/profile": {
    routeId: "/profile",
    pageFile: "src/app/(main)/profile/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 240,
    revalidateSeconds: 60,
  },
  "/messages": {
    routeId: "/messages",
    pageFile: "src/app/(main)/messages/page.tsx",
    renderingMode: "dynamic",
    dataClass: "realtime",
    cacheTtlSeconds: 0,
    invalidationOwner: "realtime",
    hydrationBoundary: "heavy",
    maxInitialPayloadKb: 320,
    allowForceDynamic: true,
  },
  "/u/[username]": {
    routeId: "/u/[username]",
    pageFile: "src/app/(main)/u/[username]/page.tsx",
    renderingMode: "dynamic",
    dataClass: "public_cached",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 260,
    revalidateSeconds: 60,
    allowForceDynamic: true,
  },
  "/workspace": {
    routeId: "/workspace",
    pageFile: "src/app/(main)/workspace/page.tsx",
    renderingMode: "dynamic",
    dataClass: "user_scoped",
    cacheTtlSeconds: 0,
    invalidationOwner: "realtime",
    hydrationBoundary: "heavy",
    maxInitialPayloadKb: 320,
    allowForceDynamic: true,
  },
  "/settings": {
    routeId: "/settings",
    pageFile: "src/app/(main)/settings/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/account": {
    routeId: "/settings/account",
    pageFile: "src/app/(main)/settings/account/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/security": {
    routeId: "/settings/security",
    pageFile: "src/app/(main)/settings/security/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/privacy": {
    routeId: "/settings/privacy",
    pageFile: "src/app/(main)/settings/privacy/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/notifications": {
    routeId: "/settings/notifications",
    pageFile: "src/app/(main)/settings/notifications/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/appearance": {
    routeId: "/settings/appearance",
    pageFile: "src/app/(main)/settings/appearance/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/integrations": {
    routeId: "/settings/integrations",
    pageFile: "src/app/(main)/settings/integrations/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
  "/settings/languages": {
    routeId: "/settings/languages",
    pageFile: "src/app/(main)/settings/languages/page.tsx",
    renderingMode: "revalidate",
    dataClass: "user_scoped",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  },
};

export const FORCE_DYNAMIC_ALLOWLIST = new Set(
  Object.values(PAGE_PERFORMANCE_CONTRACTS)
    .filter((contract) => contract.allowForceDynamic)
    .map((contract) => contract.routeId),
);

export function classifyRouteRenderingMode(routeId: string): RouteRenderingMode {
  const contract = PAGE_PERFORMANCE_CONTRACTS[routeId];
  return contract?.renderingMode ?? "static";
}

export function getRouteCachePolicy(
  routeId: string,
  viewerContext?: ViewerContext,
): RouteCachePolicy {
  const contract = PAGE_PERFORMANCE_CONTRACTS[routeId];
  if (!contract) {
    return { strategy: "none", ttlSeconds: 0, invalidationOwner: "none" };
  }

  if (contract.dataClass === "realtime") {
    return {
      strategy: "none",
      ttlSeconds: 0,
      invalidationOwner: contract.invalidationOwner,
    };
  }

  if (contract.dataClass === "user_scoped") {
    return {
      strategy: viewerContext?.isAuthenticated ? "request" : "none",
      ttlSeconds: viewerContext?.isAuthenticated ? contract.cacheTtlSeconds : 0,
      invalidationOwner: contract.invalidationOwner,
    };
  }

  return {
    strategy: "swr",
    ttlSeconds: contract.cacheTtlSeconds,
    invalidationOwner: contract.invalidationOwner,
  };
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  if (trimmed.length > 1 && trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }
  return trimmed || "/";
}

function routePatternToRegex(routeId: string): RegExp {
  const escaped = routeId
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\[([^\]]+)\\\]/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

const ROUTE_PATTERNS = Object.keys(PAGE_PERFORMANCE_CONTRACTS).map((routeId) => ({
  routeId,
  regex: routePatternToRegex(routeId),
}));

export function resolveRouteContract(pathname: string): PagePerformanceContract | null {
  const normalized = normalizePathname(pathname);
  const exact = PAGE_PERFORMANCE_CONTRACTS[normalized];
  if (exact) return exact;
  for (const entry of ROUTE_PATTERNS) {
    if (entry.regex.test(normalized)) {
      return PAGE_PERFORMANCE_CONTRACTS[entry.routeId] ?? null;
    }
  }
  return null;
}
