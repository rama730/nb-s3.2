import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeRecoveryCode,
  countRemainingRecoveryCodes,
  generateRecoveryCodes,
  normalizeRecoveryCodeInput,
} from "@/lib/security/recovery-codes";

describe("recovery code helpers", () => {
  it("generates ten one-time recovery codes", () => {
    process.env.SECURITY_RECOVERY_CODE_SECRET = "test-secret";
    const result = generateRecoveryCodes();
    assert.equal(result.codes.length, 10);
    assert.equal(result.storedCodes.length, 10);
    assert.equal(new Set(result.codes).size, 10);
    assert.equal(countRemainingRecoveryCodes(result.storedCodes), 10);
  });

  it("normalizes recovery code input", () => {
    assert.equal(normalizeRecoveryCodeInput("abCD-1234"), "ABCD1234");
  });

  it("consumes a recovery code only once", () => {
    process.env.SECURITY_RECOVERY_CODE_SECRET = "test-secret";
    const result = generateRecoveryCodes();
    const firstCode = result.codes[0]!;

    const firstUse = consumeRecoveryCode(result.storedCodes, firstCode);
    assert.equal(firstUse.matched, true);
    assert.equal(firstUse.remainingCount, 9);

    const secondUse = consumeRecoveryCode(firstUse.updatedCodes, firstCode);
    assert.equal(secondUse.matched, false);
    assert.equal(secondUse.remainingCount, 9);
  });
});
