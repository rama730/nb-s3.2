import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testOnly } from "@/lib/security/step-up";

describe("security step-up cookie helpers", () => {
  it("signs and verifies a valid step-up token", () => {
    process.env.SECURITY_STEPUP_SECRET = "step-up-secret";
    const token = __testOnly.buildSecurityStepUpValue({
      userId: "user-1",
      method: "totp",
      verifiedAt: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const parsed = __testOnly.parseSecurityStepUpValue(token);
    assert.equal(parsed?.userId, "user-1");
    assert.equal(parsed?.method, "totp");
  });

  it("rejects expired tokens", () => {
    process.env.SECURITY_STEPUP_SECRET = "step-up-secret";
    const token = __testOnly.buildSecurityStepUpValue({
      userId: "user-1",
      method: "recovery_code",
      verifiedAt: Math.floor(Date.now() / 1000) - 400,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    assert.equal(__testOnly.parseSecurityStepUpValue(token), null);
  });
});
