import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSignedJobRequestToken,
  verifySignedJobRequestToken,
} from "@/lib/security/job-request";

describe("job request signing", () => {
  it("verifies a token for the expected job scope", () => {
    process.env.JOB_REQUEST_SECRET = "test-job-request-secret";

    const token = createSignedJobRequestToken({
      kind: "git/pull",
      actorId: "user-1",
      subjectId: "project-1",
      ttlSeconds: 300,
    });

    const verification = verifySignedJobRequestToken(token, {
      kind: "git/pull",
      actorId: "user-1",
      subjectId: "project-1",
    });

    assert.equal(verification.ok, true);
  });

  it("rejects a token when the expected subject does not match", () => {
    process.env.JOB_REQUEST_SECRET = "test-job-request-secret";

    const token = createSignedJobRequestToken({
      kind: "account/cleanup",
      actorId: "user-1",
      subjectId: "deletion-1",
      ttlSeconds: 300,
    });

    const verification = verifySignedJobRequestToken(token, {
      kind: "account/cleanup",
      actorId: "user-1",
      subjectId: "deletion-2",
    });

    assert.equal(verification.ok, false);
  });
});
