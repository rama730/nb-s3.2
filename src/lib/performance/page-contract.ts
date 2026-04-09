import type { RouteClass } from "@/lib/routing/route-class";

export type RouteRenderingMode = "static" | "revalidate" | "dynamic";
export type RouteHydrationBoundary = "minimal" | "standard" | "heavy";
export type RouteCacheStrategy = "swr" | "request" | "none";
export type RouteBootstrapReadModel =
  | "static"
  | "server_query"
  | "auth_snapshot"
  | "profile_counters"
  | "redis_public_feed";
export type RouteOverloadMode = "serve_stale_or_shed" | "fail_closed";

export interface PagePerformanceContract {
  routeId: string;
  pageFile: string;
  renderingMode: RouteRenderingMode;
  routeClass: RouteClass;
  cacheStrategy: RouteCacheStrategy;
  cacheTtlSeconds: number;
  invalidationOwner: "server-action" | "api" | "realtime" | "none";
  hydrationBoundary: RouteHydrationBoundary;
  bootstrapReadModel: RouteBootstrapReadModel;
  maxBackgroundChannels: number;
  overloadMode: RouteOverloadMode;
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

function buildPublicContract(
  routeId: string,
  pageFile: string,
  input: {
    renderingMode: RouteRenderingMode;
    cacheTtlSeconds: number;
    invalidationOwner: PagePerformanceContract["invalidationOwner"];
    hydrationBoundary: RouteHydrationBoundary;
    bootstrapReadModel?: Extract<RouteBootstrapReadModel, "static" | "server_query" | "redis_public_feed">;
    maxInitialPayloadKb: number;
    revalidateSeconds?: number;
    allowForceDynamic?: boolean;
  },
): PagePerformanceContract {
  return {
    routeId,
    pageFile,
    renderingMode: input.renderingMode,
    routeClass: "public_cached",
    cacheStrategy: "swr",
    cacheTtlSeconds: input.cacheTtlSeconds,
    invalidationOwner: input.invalidationOwner,
    hydrationBoundary: input.hydrationBoundary,
    bootstrapReadModel: input.bootstrapReadModel ?? "static",
    maxBackgroundChannels: 0,
    overloadMode: "serve_stale_or_shed",
    maxInitialPayloadKb: input.maxInitialPayloadKb,
    ...(input.revalidateSeconds ? { revalidateSeconds: input.revalidateSeconds } : {}),
    ...(input.allowForceDynamic !== undefined ? { allowForceDynamic: input.allowForceDynamic } : {}),
  };
}

function buildUserShellContract(
  routeId: string,
  pageFile: string,
  input: {
    renderingMode: RouteRenderingMode;
    cacheTtlSeconds: number;
    cacheStrategy?: Extract<RouteCacheStrategy, "request" | "none">;
    invalidationOwner: PagePerformanceContract["invalidationOwner"];
    hydrationBoundary: RouteHydrationBoundary;
    bootstrapReadModel?: Extract<RouteBootstrapReadModel, "auth_snapshot" | "server_query" | "profile_counters">;
    maxInitialPayloadKb: number;
    revalidateSeconds?: number;
    allowForceDynamic?: boolean;
  },
): PagePerformanceContract {
  return {
    routeId,
    pageFile,
    renderingMode: input.renderingMode,
    routeClass: "user_shell",
    cacheStrategy: input.cacheStrategy ?? "request",
    cacheTtlSeconds: input.cacheTtlSeconds,
    invalidationOwner: input.invalidationOwner,
    hydrationBoundary: input.hydrationBoundary,
    bootstrapReadModel: input.bootstrapReadModel ?? "auth_snapshot",
    maxBackgroundChannels: 1,
    overloadMode: "fail_closed",
    maxInitialPayloadKb: input.maxInitialPayloadKb,
    ...(input.revalidateSeconds ? { revalidateSeconds: input.revalidateSeconds } : {}),
    ...(input.allowForceDynamic !== undefined ? { allowForceDynamic: input.allowForceDynamic } : {}),
  };
}

function buildActiveSurfaceContract(
  routeId: string,
  pageFile: string,
  input: {
    renderingMode: RouteRenderingMode;
    invalidationOwner: PagePerformanceContract["invalidationOwner"];
    hydrationBoundary: RouteHydrationBoundary;
    bootstrapReadModel?: Extract<RouteBootstrapReadModel, "auth_snapshot" | "profile_counters">;
    maxInitialPayloadKb: number;
    allowForceDynamic?: boolean;
  },
): PagePerformanceContract {
  return {
    routeId,
    pageFile,
    renderingMode: input.renderingMode,
    routeClass: "active_surface",
    cacheStrategy: "none",
    cacheTtlSeconds: 0,
    invalidationOwner: input.invalidationOwner,
    hydrationBoundary: input.hydrationBoundary,
    bootstrapReadModel: input.bootstrapReadModel ?? "auth_snapshot",
    maxBackgroundChannels: 2,
    overloadMode: "fail_closed",
    maxInitialPayloadKb: input.maxInitialPayloadKb,
    ...(input.allowForceDynamic !== undefined ? { allowForceDynamic: input.allowForceDynamic } : {}),
  };
}

export const PAGE_PERFORMANCE_CONTRACTS: Record<string, PagePerformanceContract> = {
  "/": buildPublicContract("/", "src/app/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 300,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 160,
  }),
  "/login": buildPublicContract("/login", "src/app/(auth)/login/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 60,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 200,
  }),
  "/signup": buildPublicContract("/signup", "src/app/(auth)/signup/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 60,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 220,
  }),
  "/forgot-password": buildPublicContract("/forgot-password", "src/app/(auth)/forgot-password/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 30,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 220,
  }),
  "/reset-password": buildPublicContract("/reset-password", "src/app/(auth)/reset-password/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 0,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 220,
  }),
  "/verify-email": buildPublicContract("/verify-email", "src/app/(auth)/verify-email/page.tsx", {
    renderingMode: "static",
    cacheTtlSeconds: 30,
    invalidationOwner: "none",
    hydrationBoundary: "minimal",
    bootstrapReadModel: "static",
    maxInitialPayloadKb: 220,
  }),
  "/onboarding": buildUserShellContract("/onboarding", "src/app/(onboarding)/onboarding/page.tsx", {
    renderingMode: "static",
    cacheStrategy: "none",
    cacheTtlSeconds: 0,
    invalidationOwner: "server-action",
    hydrationBoundary: "heavy",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 320,
    allowForceDynamic: false,
  }),
  "/hub": buildUserShellContract("/hub", "src/app/(main)/hub/page.tsx", {
    renderingMode: "dynamic",
    cacheTtlSeconds: 45,
    invalidationOwner: "api",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 260,
    allowForceDynamic: true,
  }),
  "/people": buildUserShellContract("/people", "src/app/(main)/people/page.tsx", {
    renderingMode: "dynamic",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 260,
    allowForceDynamic: true,
  }),
  "/projects/[slug]": buildPublicContract("/projects/[slug]", "src/app/(main)/projects/[slug]/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "server_query",
    maxInitialPayloadKb: 300,
    revalidateSeconds: 60,
  }),
  "/projects/new": buildUserShellContract("/projects/new", "src/app/(main)/projects/new/page.tsx", {
    renderingMode: "dynamic",
    cacheStrategy: "none",
    cacheTtlSeconds: 0,
    invalidationOwner: "server-action",
    hydrationBoundary: "heavy",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 280,
    allowForceDynamic: true,
  }),
  "/projects/[slug]/sprints/[sprintId]": buildUserShellContract("/projects/[slug]/sprints/[sprintId]", "src/app/(main)/projects/[slug]/sprints/[sprintId]/page.tsx", {
    renderingMode: "dynamic",
    cacheStrategy: "request",
    cacheTtlSeconds: 0,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 320,
    allowForceDynamic: true,
  }),
  "/profile": buildUserShellContract("/profile", "src/app/(main)/profile/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 240,
    revalidateSeconds: 60,
  }),
  "/messages": buildActiveSurfaceContract("/messages", "src/app/(main)/messages/page.tsx", {
    renderingMode: "dynamic",
    invalidationOwner: "realtime",
    hydrationBoundary: "heavy",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 320,
    allowForceDynamic: true,
  }),
  "/u/[username]": buildPublicContract("/u/[username]", "src/app/(main)/u/[username]/page.tsx", {
    renderingMode: "dynamic",
    cacheTtlSeconds: 60,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "server_query",
    maxInitialPayloadKb: 260,
    revalidateSeconds: 60,
    allowForceDynamic: true,
  }),
  "/workspace": buildActiveSurfaceContract("/workspace", "src/app/(main)/workspace/page.tsx", {
    renderingMode: "dynamic",
    invalidationOwner: "realtime",
    hydrationBoundary: "heavy",
    bootstrapReadModel: "profile_counters",
    maxInitialPayloadKb: 320,
    allowForceDynamic: true,
  }),
  "/settings": buildUserShellContract("/settings", "src/app/(main)/settings/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/account": buildUserShellContract("/settings/account", "src/app/(main)/settings/account/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/security": buildUserShellContract("/settings/security", "src/app/(main)/settings/security/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/privacy": buildUserShellContract("/settings/privacy", "src/app/(main)/settings/privacy/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/notifications": buildUserShellContract("/settings/notifications", "src/app/(main)/settings/notifications/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/appearance": buildUserShellContract("/settings/appearance", "src/app/(main)/settings/appearance/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/integrations": buildUserShellContract("/settings/integrations", "src/app/(main)/settings/integrations/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
  "/settings/languages": buildUserShellContract("/settings/languages", "src/app/(main)/settings/languages/page.tsx", {
    renderingMode: "revalidate",
    cacheTtlSeconds: 30,
    invalidationOwner: "server-action",
    hydrationBoundary: "standard",
    bootstrapReadModel: "auth_snapshot",
    maxInitialPayloadKb: 220,
    revalidateSeconds: 30,
  }),
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

  if (contract.routeClass === "active_surface" || contract.cacheStrategy === "none") {
    return {
      strategy: "none",
      ttlSeconds: 0,
      invalidationOwner: contract.invalidationOwner,
    };
  }

  if (contract.routeClass === "user_shell" && !viewerContext?.isAuthenticated) {
    return {
      strategy: "none",
      ttlSeconds: 0,
      invalidationOwner: contract.invalidationOwner,
    };
  }

  return {
    strategy: contract.cacheStrategy,
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
