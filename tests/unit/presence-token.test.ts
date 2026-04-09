import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createPresenceTokenClaims,
  MISSING_PRESENCE_SECRET_ERROR_CODE,
  MissingPresenceSecretError,
  signPresenceToken,
  verifyPresenceToken,
} from "@/lib/realtime/presence-token";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalSecret = process.env.PRESENCE_TOKEN_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalSecret === undefined) {
    delete mutableEnv.PRESENCE_TOKEN_SECRET;
  } else {
    mutableEnv.PRESENCE_TOKEN_SECRET = originalSecret;
  }

  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
    return;
  }
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("presence token", () => {
  it("requires an explicit secret outside production too", () => {
    delete mutableEnv.PRESENCE_TOKEN_SECRET;
    mutableEnv.NODE_ENV = "development";

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
      (error: unknown) => {
        assert.ok(error instanceof MissingPresenceSecretError);
        assert.equal(error.code, MISSING_PRESENCE_SECRET_ERROR_CODE);
        assert.match(error.message, /not configured/i);
        assert.doesNotMatch(error.message, /presence_token_secret/i);
        return true;
      },
    );
  });

  it("requires an explicit secret in production", () => {
    delete mutableEnv.PRESENCE_TOKEN_SECRET;
    mutableEnv.NODE_ENV = "production";

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
      (error: unknown) => {
        assert.ok(error instanceof MissingPresenceSecretError);
        assert.equal(error.code, MISSING_PRESENCE_SECRET_ERROR_CODE);
        assert.match(error.message, /not configured/i);
        assert.doesNotMatch(error.message, /presence_token_secret/i);
        return true;
      },
    );
  });

  it("signs and verifies room-scoped claims", () => {
    mutableEnv.PRESENCE_TOKEN_SECRET = "presence-test-secret";

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
    mutableEnv.PRESENCE_TOKEN_SECRET = "presence-test-secret";

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
