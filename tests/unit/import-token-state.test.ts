import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  areSealedImportTokensEqual,
  getSealedImportTokenFingerprint,
} from "../../src/lib/github/import-token-state";

describe("import token state helpers", () => {
  it("treats structurally identical sealed tokens as equal", () => {
    const first = {
      v: "v1",
      iv: "iv-1",
      ciphertext: "cipher-1",
      authTag: "tag-1",
      expiresAt: "2026-03-20T18:00:00.000Z",
    };
    const second = { ...first };

    assert.equal(areSealedImportTokensEqual(first, second), true);
  });

  it("treats different sealed tokens as different", () => {
    const first = {
      v: "v1",
      iv: "iv-1",
      ciphertext: "cipher-1",
      authTag: "tag-1",
      expiresAt: "2026-03-20T18:00:00.000Z",
    };
    const second = {
      ...first,
      ciphertext: "cipher-2",
    };

    assert.equal(areSealedImportTokensEqual(first, second), false);
  });

  it("treats nullish and malformed values safely", () => {
    assert.equal(areSealedImportTokensEqual(null, null), true);
    assert.equal(areSealedImportTokensEqual(null, undefined), true);
    assert.equal(areSealedImportTokensEqual(null, { nope: true }), false);
  });

  it("builds a stable fingerprint for structurally identical tokens", () => {
    const first = {
      v: "v1",
      iv: "iv-1",
      ciphertext: "cipher-1",
      authTag: "tag-1",
      expiresAt: "2026-03-20T18:00:00.000Z",
    };

    assert.equal(
      getSealedImportTokenFingerprint(first),
      getSealedImportTokenFingerprint({ ...first }),
    );
  });
});
