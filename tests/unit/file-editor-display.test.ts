import test from "node:test";
import assert from "node:assert/strict";

import { getLockDisplayName, getOperationLabel } from "@/components/projects/v2/file-editor-display";

test("getOperationLabel maps internal operations to user-facing copy", () => {
  assert.equal(getOperationLabel("lock_release"), "Lock released");
  assert.equal(getOperationLabel("create_file"), "Created file");
  assert.equal(getOperationLabel("trash_item"), "Trash Item");
});

test("getLockDisplayName never falls back to raw identifiers", () => {
  assert.equal(
    getLockDisplayName({
      lockedBy: "2b4030a1-b030-4a50-811a-0da96b88c224",
      lockedByName: null,
      expiresAt: Date.now(),
    }),
    "Locked by collaborator",
  );
  assert.equal(
    getLockDisplayName({
      lockedBy: "user-1",
      lockedByName: "Edge Builder",
      expiresAt: Date.now(),
    }),
    "Edge Builder",
  );
});
