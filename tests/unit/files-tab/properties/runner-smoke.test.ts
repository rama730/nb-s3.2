import { describe, it } from "node:test";
import fc from "fast-check";

// PBT runner smoke test: verifies that `import fc from "fast-check"` resolves
// under `tsx --test` and that `npm run test:unit` picks up files in
// `tests/unit/files-tab/properties/`.
//
// Acceptance for Task 1.2 (Files Tab GitHub Redesign spec):
//   - `import fc from "fast-check"` resolves under `tsx --test`
//   - `npm run test:unit` picks up files in the new folder
//
// This file intentionally uses a trivial universally-true property. It is
// NOT one of the four mandated correctness properties (Tasks 2.7–2.10) and
// should be replaced/deleted once those are authored.
describe("fast-check runner smoke", () => {
  it("imports fast-check and runs a property with numRuns >= 100", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n === n),
      { numRuns: 100 },
    );
  });
});
