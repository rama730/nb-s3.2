import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRouteRenderingMode,
  getRouteCachePolicy,
  PAGE_PERFORMANCE_CONTRACTS,
  resolveRouteContract,
} from "@/lib/performance/page-contract";

describe("page performance contract", () => {
  it("has one contract per page route", () => {
    assert.equal(Object.keys(PAGE_PERFORMANCE_CONTRACTS).length, 22);
  });

  it("resolves dynamic route contracts from concrete URLs", () => {
    const projectRoute = resolveRouteContract("/projects/network-for-builders");
    assert.equal(projectRoute?.routeId, "/projects/[slug]");

    const userRoute = resolveRouteContract("/u/ch_rama1");
    assert.equal(userRoute?.routeId, "/u/[username]");
  });

  it("classifies rendering mode from route id", () => {
    assert.equal(classifyRouteRenderingMode("/hub"), "dynamic");
    assert.equal(classifyRouteRenderingMode("/settings"), "revalidate");
    assert.equal(classifyRouteRenderingMode("/login"), "static");
  });

  it("returns deterministic cache policy by route class", () => {
    assert.deepEqual(getRouteCachePolicy("/hub"), {
      strategy: "none",
      ttlSeconds: 0,
      invalidationOwner: "api",
    });

    assert.deepEqual(getRouteCachePolicy("/settings", { isAuthenticated: true }), {
      strategy: "request",
      ttlSeconds: 30,
      invalidationOwner: "server-action",
    });
  });

  it("tracks explicit bootstrap and overload contracts for hot routes", () => {
    assert.deepEqual(
      {
        routeClass: PAGE_PERFORMANCE_CONTRACTS["/workspace"]?.routeClass,
        bootstrapReadModel: PAGE_PERFORMANCE_CONTRACTS["/workspace"]?.bootstrapReadModel,
        maxBackgroundChannels: PAGE_PERFORMANCE_CONTRACTS["/workspace"]?.maxBackgroundChannels,
        overloadMode: PAGE_PERFORMANCE_CONTRACTS["/workspace"]?.overloadMode,
      },
      {
        routeClass: "active_surface",
        bootstrapReadModel: "profile_counters",
        maxBackgroundChannels: 2,
        overloadMode: "fail_closed",
      },
    );

    assert.deepEqual(
      {
        routeClass: PAGE_PERFORMANCE_CONTRACTS["/"]?.routeClass,
        bootstrapReadModel: PAGE_PERFORMANCE_CONTRACTS["/"]?.bootstrapReadModel,
        maxBackgroundChannels: PAGE_PERFORMANCE_CONTRACTS["/"]?.maxBackgroundChannels,
        overloadMode: PAGE_PERFORMANCE_CONTRACTS["/"]?.overloadMode,
      },
      {
        routeClass: "public_cached",
        bootstrapReadModel: "static",
        maxBackgroundChannels: 0,
        overloadMode: "serve_stale_or_shed",
      },
    );
  });
});
