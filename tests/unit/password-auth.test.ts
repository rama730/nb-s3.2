import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testOnly } from "@/lib/security/password-auth";

describe("password auth helpers", () => {
  it("returns an invalid-password result without signing out when credentials are invalid", async () => {
    let signOutCalls = 0;

    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                message: "Invalid login credentials",
                code: "invalid_credentials",
                status: 400,
              },
            };
          },
          async signOut() {
            signOutCalls += 1;
          },
        },
      },
      "user@example.com",
      "bad-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "invalid_credentials",
      message: "Invalid login credentials",
    });
    assert.equal(signOutCalls, 0);
  });

  it("uses a generic fallback message for non-credential verification failures", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                code: "unexpected_failure",
                status: 500,
              },
            };
          },
          async signOut() {},
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "verification_failed",
      message: "Unable to verify password",
    });
  });

  it("preserves backend error messages for non-credential verification failures", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                message: "Auth service temporarily unavailable",
                code: "service_unavailable",
                status: 503,
              },
            };
          },
          async signOut() {},
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "verification_failed",
      message: "Auth service temporarily unavailable",
    });
  });

  it("signs out the temporary verifier session after a successful password check", async () => {
    let signOutCalls = 0;

    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return { error: null };
          },
          async signOut() {
            signOutCalls += 1;
          },
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(signOutCalls, 1);
  });

  it("keeps verification successful even when temporary-session cleanup fails", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return { error: null };
          },
          async signOut() {
            throw new Error("cleanup failed");
          },
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, { ok: true });
  });
});
