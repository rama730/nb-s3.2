import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";

describe("security mfa helpers", () => {
  it("returns an empty array when the MFA API is unavailable", async () => {
    const factors = await listSecurityMfaFactors({});
    assert.deepEqual(factors, []);
  });

  it("maps supported MFA factors into the security payload shape", async () => {
    const factors = await listSecurityMfaFactors({
      auth: {
        mfa: {
          async listFactors() {
            return {
              data: {
                all: [
                  {
                    id: "totp-1",
                    factor_type: "totp",
                    friendly_name: "Phone app",
                    created_at: "2026-03-20T12:00:00.000Z",
                    status: "verified",
                  },
                  {
                    id: "phone-1",
                    factor_type: "phone",
                    status: "unverified",
                  },
                  {
                    id: "webauthn-1",
                    factor_type: "webauthn",
                    status: "verified",
                  },
                ],
              },
              error: null,
            };
          },
        },
      },
    });

    assert.deepEqual(factors, [
      {
        id: "totp-1",
        type: "totp",
        friendly_name: "Phone app",
        created_at: "2026-03-20T12:00:00.000Z",
        status: "verified",
      },
      {
        id: "phone-1",
        type: "phone",
        friendly_name: undefined,
        created_at: undefined,
        status: "unverified",
      },
    ]);
    assert.deepEqual(getVerifiedTotpFactors(factors), [
      {
        id: "totp-1",
        type: "totp",
        friendly_name: "Phone app",
        created_at: "2026-03-20T12:00:00.000Z",
        status: "verified",
      },
    ]);
  });

  it("propagates MFA factor listing errors", async () => {
    await assert.rejects(
      listSecurityMfaFactors({
        auth: {
          mfa: {
            async listFactors() {
              return {
                data: null,
                error: new Error("mfa backend unavailable"),
              };
            },
          },
        },
      }),
      /mfa backend unavailable/,
    );
  });

  it("fails fast when a supported MFA factor is missing an id", async () => {
    await assert.rejects(
      listSecurityMfaFactors({
        auth: {
          mfa: {
            async listFactors() {
              return {
                data: {
                  all: [
                    {
                      id: null,
                      factor_type: "totp",
                      status: "verified",
                    },
                  ],
                },
                error: null,
              };
            },
          },
        },
      }),
      /missing an id/,
    );
  });
});
