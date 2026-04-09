import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STANDARDS_RULES, getStandardsRule } from "@/lib/standards/rules";

describe("standards rule registry", () => {
  it("uses unique stable rule ids", () => {
    const ids = STANDARDS_RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps evidence attached to every rule", () => {
    for (const rule of STANDARDS_RULES) {
      assert.ok(rule.evidence.length > 0, `${rule.id} is missing evidence sources`);
      assert.ok(rule.exceptionPolicy.length > 0, `${rule.id} is missing an exception policy`);
    }
  });

  it("can resolve rule metadata by id", () => {
    assert.equal(getStandardsRule("NB-CON-001")?.title, "Canonical Logic Reuse");
    assert.equal(getStandardsRule("missing-rule"), null);
  });
});
