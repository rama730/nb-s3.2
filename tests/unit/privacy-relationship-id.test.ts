import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { derivePrivacyRelationshipState } from "@/lib/privacy/relationship-state";

test("an accepted cache proof never manufactures a database relationship ID", () => {
  const result = derivePrivacyRelationshipState({
    viewerId: "viewer",
    targetUserId: "target",
    latestConnection: {
      id: null,
      requesterId: "viewer",
      addresseeId: "target",
      status: "accepted",
      blockedBy: null,
    },
  });

  assert.equal(result.isConnected, true);
  assert.equal(result.latestConnectionId, null);

  const resolver = fs.readFileSync(path.join(process.cwd(), "src/lib/privacy/resolver.ts"), "utf8");
  assert.doesNotMatch(resolver, /redis-fast-path-/);
});
