import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeJsonLd } from "../../src/lib/security/json-ld";

describe("serializeJsonLd", () => {
  it("escapes script-breaking less-than characters while preserving JSON", () => {
    const serialized = serializeJsonLd({ title: "</script><script>alert(1)</script>" });

    assert.equal(serialized.includes("<"), false);
    assert.deepEqual(JSON.parse(serialized), {
      title: "</script><script>alert(1)</script>",
    });
  });
});
