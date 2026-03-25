import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createPresenceTokenClaims,
  signPresenceToken,
  verifyPresenceToken,
} from "@/lib/realtime/presence-token";

const originalSecret = process.env.PRESENCE_TOKEN_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.PRESENCE_TOKEN_SECRET;
    return;
  }
  process.env.PRESENCE_TOKEN_SECRET = originalSecret;
});

describe("presence token", () => {
  it("requires a dedicated presence token secret", () => {
    delete process.env.PRESENCE_TOKEN_SECRET;

    const claims = createPresenceTokenClaims({
      userId: "user-1",
      sessionId: "session-1",
      roomType: "workspace",
      roomId: "project-1",
      role: "editor",
      ttlSeconds: 60,
    });

    assert.throws(
      () => signPresenceToken(claims),
      /PRESENCE_TOKEN_SECRET is required to issue presence room tokens/i,
    );
  });

  it("signs and verifies room-scoped claims", () => {
    process.env.PRESENCE_TOKEN_SECRET = "presence-test-secret";

    const claims = createPresenceTokenClaims({
      userId: "user-1",
      sessionId: "session-1",
      roomType: "workspace",
      roomId: "project-1",
      role: "editor",
      ttlSeconds: 60,
    });
    const token = signPresenceToken(claims);
    const verified = verifyPresenceToken(token);

    assert.equal(verified.userId, "user-1");
    assert.equal(verified.sessionId, "session-1");
    assert.equal(verified.roomType, "workspace");
    assert.equal(verified.roomId, "project-1");
    assert.equal(verified.role, "editor");
  });

  it("rejects expired tokens", () => {
    process.env.PRESENCE_TOKEN_SECRET = "presence-test-secret";

    const token = signPresenceToken({
      userId: "user-1",
      sessionId: null,
      roomType: "conversation",
      roomId: "conversation-1",
      role: "viewer",
      iat: Math.floor(Date.now() / 1000) - 120,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    assert.throws(() => verifyPresenceToken(token), /expired/i);
  });
});
