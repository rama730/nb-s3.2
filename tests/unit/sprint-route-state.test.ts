import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProjectSprintDetailHref,
  buildProjectSprintTabHref,
  parseSprintRouteState,
} from "@/lib/projects/sprint-detail";

describe("sprint route state", () => {
  it("parses filter and drawer state from search params", () => {
    const params = new URLSearchParams({
      filter: "files",
      mode: "grouped",
      drawerType: "file",
      drawerId: "node-123",
    });

    const state = parseSprintRouteState(params);

    assert.equal(state.filter, "files");
    assert.equal(state.mode, "grouped");
    assert.deepEqual(state.drawer, { type: "file", id: "node-123" });
  });

  it("falls back to canonical defaults for invalid route state", () => {
    const state = parseSprintRouteState({
      filter: "invalid-value",
      drawerType: "task",
      drawerId: "",
    });

    assert.equal(state.filter, "all");
    assert.deepEqual(state.drawer, { type: "none", id: null });
  });

  it("builds stable sprint tab and detail hrefs", () => {
    assert.equal(buildProjectSprintTabHref("network-for-builders"), "/projects/network-for-builders?tab=sprints");
    assert.equal(
      buildProjectSprintTabHref("network-for-builders", {
        filter: "blocked",
        mode: "grouped",
        drawer: { type: "task", id: "task-1" },
      }),
      "/projects/network-for-builders?tab=sprints&filter=blocked&mode=grouped&drawerType=task&drawerId=task-1",
    );
    assert.equal(
      buildProjectSprintDetailHref("network-for-builders", "sprint-1", {
        filter: "files",
        mode: "files",
        drawer: { type: "file", id: "node-1" },
      }),
      "/projects/network-for-builders/sprints/sprint-1?filter=files&mode=files&drawerType=file&drawerId=node-1",
    );
    assert.equal(
      buildProjectSprintTabHref("network/builders & co"),
      "/projects/network%2Fbuilders%20%26%20co?tab=sprints",
    );
    assert.equal(
      buildProjectSprintDetailHref("network/builders & co", "sprint/1?draft=true"),
      "/projects/network%2Fbuilders%20%26%20co/sprints/sprint%2F1%3Fdraft%3Dtrue",
    );
  });
});
