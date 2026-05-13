// Task 2.4 acceptance tests — `useFilesTabUrlSync` + `useDeepLinkResolver`.
//
// Acceptance (tasks.md § 2.4):
//   (i)   replaceState only, never pushState
//   (ii)  root state clears `?path=` (no key, NOT an empty-value `?path=`)
//   (iii) >4096-char deep link falls back to root + inline error
//   (iv)  popstate triggers re-resolve
//
// jsdom is not installed in this repo. Following the pattern established by
// `tests/unit/files-tab/use-folder-contents.test.ts`, we exercise the pure
// helpers (`syncUrlToLocation`, `handlePopState`, `resolveDeepLinkFromSearch`,
// `planUrlSync`) which together cover the full observable behavior of the
// React hook wrappers. A lightweight `FakeWindow` stub stands in for the
// browser `window` when tests need to verify `history.replaceState` call
// counts and argument shapes.
//
// Requirements: Req 10.1, Req 10.4–10.5, Req 19.8, Req 20.1, Req 20.3, Req 20.4.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEEP_LINK_MAX_LENGTH,
  evaluateDeepLinkPath,
  planUrlSync,
} from "@/components/projects/v2/files-tab/url";
import {
  handlePopState,
  syncUrlToLocation,
} from "@/components/projects/v2/files-tab/hooks/useFilesTabUrlSync";
import {
  resolveDeepLinkFromSearch,
  type ResolveDeepLinkResult,
} from "@/components/projects/v2/files-tab/hooks/useDeepLinkResolver";

// ─── FakeWindow shim ─────────────────────────────────────────────────

interface HistoryCall {
  method: "pushState" | "replaceState";
  state: unknown;
  title: string;
  url: string | null;
}

class FakeHistory {
  calls: HistoryCall[] = [];
  state: unknown = null;
  replaceState(state: unknown, title: string, url?: string | null): void {
    this.state = state;
    this.calls.push({ method: "replaceState", state, title, url: url ?? null });
  }
  pushState(state: unknown, title: string, url?: string | null): void {
    this.state = state;
    this.calls.push({ method: "pushState", state, title, url: url ?? null });
  }
}

class FakeLocation {
  pathname = "/projects/proj-1";
  search = "";
  hash = "";
  constructor(init?: { pathname?: string; search?: string; hash?: string }) {
    if (init?.pathname !== undefined) this.pathname = init.pathname;
    if (init?.search !== undefined) this.search = init.search;
    if (init?.hash !== undefined) this.hash = init.hash;
  }
}

function makeWindow(init: { pathname?: string; search?: string; hash?: string } = {}): {
  location: FakeLocation;
  history: FakeHistory;
} {
  return {
    location: new FakeLocation(init),
    history: new FakeHistory(),
  };
}

// ─── planUrlSync / syncUrlToLocation — acceptance (i) + (ii) ─────────

describe("planUrlSync (Task 2.4 — Req 10.1, 10.4, 20.1)", () => {
  it("emits a URL without `?path=` at all when encodedPath is empty (root state)", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "?path=src%2FApp.tsx",
      hash: "",
      encodedPath: "",
    });
    assert.deepEqual(plan, { action: "replace", url: "/projects/proj-1" });
  });

  it("distinguishes 'no path key' from 'empty-value path key' — clearing writes no key", () => {
    // Task note: "Root state: no `?path=` parameter (not empty-value
    // `?path=`)". The output must never contain `path=` with an empty
    // right-hand side.
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "?path=",
      hash: "",
      encodedPath: "",
    });
    assert.deepEqual(plan, { action: "replace", url: "/projects/proj-1" });
  });

  it("writes `?path=src%2FApp.tsx` for a nested location", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "",
      hash: "",
      encodedPath: "src/App.tsx",
    });
    assert.deepEqual(plan, {
      action: "replace",
      url: "/projects/proj-1?path=src/App.tsx",
    });
  });

  it("preserves unrelated query params verbatim, placing `path` last", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "?tab=files&view=code",
      hash: "",
      encodedPath: "src/App.tsx",
    });
    assert.deepEqual(plan, {
      action: "replace",
      url: "/projects/proj-1?tab=files&view=code&path=src/App.tsx",
    });
  });

  it("preserves the URL hash", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "",
      hash: "#L42",
      encodedPath: "src/App.tsx",
    });
    assert.deepEqual(plan, {
      action: "replace",
      url: "/projects/proj-1?path=src/App.tsx#L42",
    });
  });

  it("returns noop when the URL already matches the encoded path", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "?path=src/App.tsx",
      hash: "",
      encodedPath: "src/App.tsx",
    });
    assert.deepEqual(plan, { action: "noop" });
  });

  it("returns noop at root state when the URL already has no path key", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "",
      hash: "",
      encodedPath: "",
    });
    assert.deepEqual(plan, { action: "noop" });
  });

  it("drops a stale `path` key when moving to root even if it appears in the middle of the query", () => {
    const plan = planUrlSync({
      pathname: "/projects/proj-1",
      search: "?path=old&tab=files",
      hash: "",
      encodedPath: "",
    });
    assert.deepEqual(plan, {
      action: "replace",
      url: "/projects/proj-1?tab=files",
    });
  });
});

describe("syncUrlToLocation (Task 2.4 — Req 10.4 ONLY replaceState)", () => {
  it("calls history.replaceState and NEVER history.pushState", () => {
    const win = makeWindow({ search: "" });
    const didWrite = syncUrlToLocation({ win, encodedPath: "src/App.tsx" });

    assert.equal(didWrite, true);
    assert.equal(win.history.calls.length, 1);
    assert.equal(win.history.calls[0]?.method, "replaceState");
    assert.equal(win.history.calls[0]?.url, "/projects/proj-1?path=src/App.tsx");
    const pushStateCalls = win.history.calls.filter((c) => c.method === "pushState");
    assert.equal(pushStateCalls.length, 0, "pushState must never be called (Req 10.4)");
  });

  it("at root state, replaceState removes the `?path=` key entirely (ii)", () => {
    const win = makeWindow({ search: "?path=src%2FApp.tsx" });
    syncUrlToLocation({ win, encodedPath: "" });

    assert.equal(win.history.calls.length, 1);
    assert.equal(win.history.calls[0]?.url, "/projects/proj-1");
    assert.ok(
      !(win.history.calls[0]?.url ?? "").includes("path="),
      "URL must not contain any `path=` key at root state",
    );
  });

  it("noops when the URL already matches — no spurious replaceState", () => {
    const win = makeWindow({ search: "?path=src/App.tsx" });
    const didWrite = syncUrlToLocation({ win, encodedPath: "src/App.tsx" });

    assert.equal(didWrite, false);
    assert.equal(win.history.calls.length, 0);
  });

  it("preserves the existing history.state object on replaceState", () => {
    const win = makeWindow({ search: "" });
    const opaqueState = { foo: "bar", bookmark: 42 };
    win.history.state = opaqueState;

    syncUrlToLocation({ win, encodedPath: "src/App.tsx" });

    assert.equal(win.history.calls[0]?.state, opaqueState);
  });
});

// ─── evaluateDeepLinkPath / resolveDeepLinkFromSearch — (iii) ────────

describe("evaluateDeepLinkPath (Task 2.4 — Req 10.5)", () => {
  it("returns 'none' for a null input (no `?path=` present)", () => {
    assert.deepEqual(evaluateDeepLinkPath(null), { kind: "none" });
  });

  it("returns error/empty for the empty-value case `?path=`", () => {
    assert.deepEqual(evaluateDeepLinkPath(""), { kind: "error", reason: "empty" });
  });

  it("returns error/empty when value is whitespace only", () => {
    assert.deepEqual(evaluateDeepLinkPath("   "), { kind: "error", reason: "empty" });
  });

  it("returns error/empty when value is only slashes", () => {
    assert.deepEqual(evaluateDeepLinkPath("///"), { kind: "error", reason: "empty" });
  });

  it("returns error/overlength at exactly 4097 chars", () => {
    const overlength = "a".repeat(DEEP_LINK_MAX_LENGTH + 1);
    assert.deepEqual(evaluateDeepLinkPath(overlength), {
      kind: "error",
      reason: "overlength",
    });
  });

  it("accepts exactly 4096 chars as the boundary", () => {
    const boundary = "a".repeat(DEEP_LINK_MAX_LENGTH);
    assert.deepEqual(evaluateDeepLinkPath(boundary), {
      kind: "resolvable",
      segments: [boundary],
    });
  });

  it("returns resolvable for a normal segmented path", () => {
    assert.deepEqual(evaluateDeepLinkPath("src/App.tsx"), {
      kind: "resolvable",
      segments: ["src", "App.tsx"],
    });
  });

  it("decodes percent-encoded segments", () => {
    assert.deepEqual(evaluateDeepLinkPath("src/my%20file.txt"), {
      kind: "resolvable",
      segments: ["src", "my file.txt"],
    });
  });
});

describe("resolveDeepLinkFromSearch (Task 2.4 — Req 10.5, Req 20.4)", () => {
  const projectId = "proj-1";

  it("returns 'none' when no `?path=` param is present", async () => {
    const result = await resolveDeepLinkFromSearch(null, {
      projectId,
      findNodeByPathAny: async () => {
        throw new Error("lookup must not run for null path");
      },
    });
    assert.deepEqual(result, { kind: "none" });
  });

  it("returns 'empty' for an empty-value `?path=`", async () => {
    const result = await resolveDeepLinkFromSearch("", {
      projectId,
      findNodeByPathAny: async () => {
        throw new Error("lookup must not run for empty path");
      },
    });
    assert.deepEqual(result, { kind: "empty" });
  });

  it("returns 'overlength' for a >4096-char deep link — (iii)", async () => {
    const overlength = "a".repeat(DEEP_LINK_MAX_LENGTH + 1);
    let looked = false;
    const result = await resolveDeepLinkFromSearch(overlength, {
      projectId,
      findNodeByPathAny: async () => {
        looked = true;
        return { id: "X" };
      },
    });
    assert.deepEqual(result, { kind: "overlength" });
    assert.equal(looked, false, "lookup must not run for an overlength path (Req 19.8)");
  });

  it("returns 'ok' with the resolved node id when findNodeByPathAny succeeds", async () => {
    const calls: string[][] = [];
    const result = await resolveDeepLinkFromSearch("src/App.tsx", {
      projectId,
      findNodeByPathAny: async (pid, parts) => {
        assert.equal(pid, projectId);
        calls.push(parts);
        return { id: "node-123" };
      },
    });
    assert.deepEqual(result, { kind: "ok", nodeId: "node-123" });
    assert.deepEqual(calls, [["src", "App.tsx"]]);
  });

  it("returns 'not_found' when findNodeByPathAny returns null", async () => {
    const result = await resolveDeepLinkFromSearch("missing/path.txt", {
      projectId,
      findNodeByPathAny: async () => null,
    });
    assert.deepEqual(result, {
      kind: "not_found",
      segments: ["missing", "path.txt"],
    });
  });

  it("treats a thrown findNodeByPathAny (network/access error) as not_found", async () => {
    const result = await resolveDeepLinkFromSearch("secret/file", {
      projectId,
      findNodeByPathAny: async () => {
        throw new Error("Unauthorized");
      },
    });
    assert.deepEqual(result, { kind: "not_found", segments: ["secret", "file"] });
  });
});

// ─── handlePopState — acceptance (iv) ────────────────────────────────

describe("handlePopState (Task 2.4 — Req 20.3)", () => {
  it("re-reads the URL and dispatches navigateTo with the resolved id", async () => {
    const win = makeWindow({ search: "?path=src%2FApp.tsx" });
    const navigateCalls: Array<string | null> = [];
    const errorCalls: Array<
      Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>
    > = [];

    await handlePopState({
      win,
      navigateTo: (id) => navigateCalls.push(id),
      onError: (failure) => errorCalls.push(failure),
      projectId: "proj-1",
      findNodeByPathAny: async (_pid, parts) => {
        assert.deepEqual(parts, ["src", "App.tsx"]);
        return { id: "resolved-42" };
      },
    });

    assert.deepEqual(navigateCalls, ["resolved-42"]);
    assert.deepEqual(errorCalls, [], "no error callback on success");
  });

  it("dispatches navigateTo(null) and onError for an overlength URL on back/forward", async () => {
    const overlength = "a".repeat(DEEP_LINK_MAX_LENGTH + 1);
    const win = makeWindow({ search: `?path=${overlength}` });
    const navigateCalls: Array<string | null> = [];
    const errorCalls: Array<
      Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>
    > = [];

    await handlePopState({
      win,
      navigateTo: (id) => navigateCalls.push(id),
      onError: (failure) => errorCalls.push(failure),
      projectId: "proj-1",
      findNodeByPathAny: async () => {
        throw new Error("must not run for overlength");
      },
    });

    assert.deepEqual(navigateCalls, [null], "root fallback on overlength (Req 10.5)");
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0]?.kind, "overlength");
  });

  it("dispatches navigateTo(null) (root) when URL has no `?path=`", async () => {
    const win = makeWindow({ search: "" });
    const navigateCalls: Array<string | null> = [];
    const errorCalls: Array<
      Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>
    > = [];

    await handlePopState({
      win,
      navigateTo: (id) => navigateCalls.push(id),
      onError: (failure) => errorCalls.push(failure),
      projectId: "proj-1",
      findNodeByPathAny: async () => {
        throw new Error("must not run when no path param");
      },
    });

    // `none` is not an error — root state is the normal "no path" case. We
    // still dispatch navigateTo(null) so the store reflects the URL that
    // back/forward landed on.
    assert.deepEqual(navigateCalls, [null]);
    assert.deepEqual(errorCalls, [], "no error indicator when URL is simply root");
  });

  it("dispatches navigateTo(null) + onError for a deep link that no longer exists", async () => {
    const win = makeWindow({ search: "?path=removed%2Ffile.txt" });
    const navigateCalls: Array<string | null> = [];
    const errorCalls: Array<
      Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>
    > = [];

    await handlePopState({
      win,
      navigateTo: (id) => navigateCalls.push(id),
      onError: (failure) => errorCalls.push(failure),
      projectId: "proj-1",
      findNodeByPathAny: async () => null,
    });

    assert.deepEqual(navigateCalls, [null]);
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0]?.kind, "not_found");
  });
});
