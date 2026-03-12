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
    assert.equal(Object.keys(PAGE_PERFORMANCE_CONTRACTS).length, 19);
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

  it("returns deterministic cache policy by route/data class", () => {
    assert.deepEqual(getRouteCachePolicy("/hub"), {
      strategy: "none",
      ttlSeconds: 0,
      invalidationOwner: "realtime",
    });

    assert.deepEqual(getRouteCachePolicy("/settings", { isAuthenticated: true }), {
      strategy: "request",
      ttlSeconds: 30,
      invalidationOwner: "server-action",
    });
  });
});

