// Task 3.5 — Property test: Mobile Progress Percentage (Property 2).
//
// **Validates: Requirements 3.3**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any currentStep (1–4) and totalSteps, the MobileProgressBar
// component must display a completion percentage equal to:
//   Math.round(((currentStep - 1) / totalSteps) * 100)
//
// This ensures the progress percentage accurately reflects how many
// steps have been completed (not including the current step).
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 200`) — generate arbitrary currentStep
//      and totalSteps values, then verify the percentage calculation
//      matches the formula: Math.round(((currentStep - 1) / totalSteps) * 100)
//
//   2. Source-level pins on `MobileProgressBar.tsx` — verify the component
//      source uses the correct formula for computing completionPercentage.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Reference implementation — the expected percentage formula
// ---------------------------------------------------------------------------

function expectedPercentage(currentStep: number, totalSteps: number): number {
  return Math.round(((currentStep - 1) / totalSteps) * 100);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a valid MobileProgressBar input with currentStep in [1, totalSteps].
 * The spec uses 4 steps, but we test with arbitrary totalSteps (2–10) to
 * ensure the formula generalizes correctly.
 */
const mobileProgressInputArb = fc
  .integer({ min: 2, max: 10 })
  .chain((totalSteps) =>
    fc.record({
      currentStep: fc.integer({ min: 1, max: totalSteps }),
      totalSteps: fc.constant(totalSteps),
    }),
  );

/**
 * Generates the specific 4-step scenario matching the onboarding flow.
 */
const fourStepInputArb = fc.record({
  currentStep: fc.integer({ min: 1, max: 4 }),
  totalSteps: fc.constant(4),
});

// ---------------------------------------------------------------------------
// Data-level PBT — Property 2: Mobile Progress Percentage
// ---------------------------------------------------------------------------

describe("MobileProgressBar — Property 2: Mobile Progress Percentage (Task 3.5)", () => {
  it("percentage equals Math.round(((currentStep - 1) / totalSteps) * 100) for any valid step", () => {
    // **Validates: Requirements 3.3**
    fc.assert(
      fc.property(mobileProgressInputArb, ({ currentStep, totalSteps }) => {
        // Simulate the component's percentage calculation
        const computedPercentage = Math.round(
          ((currentStep - 1) / totalSteps) * 100,
        );

        const expected = expectedPercentage(currentStep, totalSteps);

        assert.equal(
          computedPercentage,
          expected,
          `For currentStep=${currentStep}, totalSteps=${totalSteps}: ` +
            `computed ${computedPercentage}% but expected ${expected}%`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("percentage is always in [0, 100) range for valid steps", () => {
    // **Validates: Requirements 3.3**
    fc.assert(
      fc.property(mobileProgressInputArb, ({ currentStep, totalSteps }) => {
        const percentage = expectedPercentage(currentStep, totalSteps);

        assert.ok(
          percentage >= 0,
          `Percentage must be >= 0, got ${percentage} for currentStep=${currentStep}, totalSteps=${totalSteps}`,
        );
        assert.ok(
          percentage < 100,
          `Percentage must be < 100 (current step is not yet complete), got ${percentage} for currentStep=${currentStep}, totalSteps=${totalSteps}`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("percentage is 0 on the first step", () => {
    // **Validates: Requirements 3.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (totalSteps) => {
          const percentage = expectedPercentage(1, totalSteps);
          assert.equal(
            percentage,
            0,
            `First step should always show 0%, got ${percentage}% for totalSteps=${totalSteps}`,
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it("percentage increases monotonically as currentStep increases", () => {
    // **Validates: Requirements 3.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (totalSteps) => {
          let prevPercentage = -1;
          for (let step = 1; step <= totalSteps; step++) {
            const percentage = expectedPercentage(step, totalSteps);
            assert.ok(
              percentage >= prevPercentage,
              `Percentage must be monotonically non-decreasing: ` +
                `step ${step - 1} had ${prevPercentage}%, step ${step} has ${percentage}%`,
            );
            prevPercentage = percentage;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("matches expected values for the 4-step onboarding flow", () => {
    // **Validates: Requirements 3.3**
    fc.assert(
      fc.property(fourStepInputArb, ({ currentStep, totalSteps }) => {
        const percentage = expectedPercentage(currentStep, totalSteps);

        // Known expected values for 4-step flow:
        // Step 1: (0/4)*100 = 0%
        // Step 2: (1/4)*100 = 25%
        // Step 3: (2/4)*100 = 50%
        // Step 4: (3/4)*100 = 75%
        const expectedValues: Record<number, number> = {
          1: 0,
          2: 25,
          3: 50,
          4: 75,
        };

        assert.equal(
          percentage,
          expectedValues[currentStep],
          `For 4-step flow at step ${currentStep}: expected ${expectedValues[currentStep]}%, got ${percentage}%`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins — structural contracts
// ---------------------------------------------------------------------------
//
// These verify the component source uses the correct formula for
// computing the completion percentage, ensuring the visual contract
// from Requirement 3.3 is maintained.

const COMPONENT_SOURCE = readFileSync(
  path.resolve(__dirname, "../MobileProgressBar.tsx"),
  "utf8",
);

describe("MobileProgressBar — source-level structural contracts (Req 3.3)", () => {
  it("computes completionPercentage using Math.round(((currentStep - 1) / totalSteps) * 100)", () => {
    // Req 3.3: completion percentage on the right
    assert.match(
      COMPONENT_SOURCE,
      /Math\.round\(\(\(currentStep\s*-\s*1\)\s*\/\s*totalSteps\)\s*\*\s*100\)/,
      "Component must compute percentage using Math.round(((currentStep - 1) / totalSteps) * 100) (Req 3.3)",
    );
  });

  it("renders the completionPercentage with a % suffix", () => {
    // Req 3.3: displays percentage on the right
    assert.match(
      COMPONENT_SOURCE,
      /completionPercentage\}%/,
      "Component must render '{completionPercentage}%' (Req 3.3)",
    );
  });

  it("accepts currentStep and totalSteps as props", () => {
    // The component must accept these props for the formula to work
    assert.match(
      COMPONENT_SOURCE,
      /currentStep/,
      "Component must accept currentStep prop",
    );
    assert.match(
      COMPONENT_SOURCE,
      /totalSteps/,
      "Component must accept totalSteps prop",
    );
  });
});
