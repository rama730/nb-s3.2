import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeLinkedNodesWithAnnotationOverrides } from "@/lib/projects/task-file-note-sync";

describe("task files explorer note sync", () => {
  it("preserves a freshly saved note while parent attachments are still stale", () => {
    const nodes = [
      {
        id: "node-1",
        name: "hello.py",
        type: "file" as const,
        annotation: null,
      },
    ] as any;

    const merged = mergeLinkedNodesWithAnnotationOverrides(nodes, {
      "node-1": "Investigate the parser bug in this file.",
    });

    assert.equal(merged[0]?.annotation, "Investigate the parser bug in this file.");
  });

  it("preserves an explicit note clear while parent attachments still carry the old note", () => {
    const nodes = [
      {
        id: "node-1",
        name: "hello.py",
        type: "file" as const,
        annotation: "Old note",
      },
    ] as any;

    const merged = mergeLinkedNodesWithAnnotationOverrides(nodes, {
      "node-1": null,
    });

    assert.equal(merged[0]?.annotation, null);
  });
});
