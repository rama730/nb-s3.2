// Task 3.8 — Property Test: Disabled Button State (Property 14)
//
// **Validates: Requirements 5.5**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any step where the proceed condition is not met (canProceed=false),
// the Continue button SHALL render at 50% opacity with pointer-events
// disabled.
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern (tests/unit/files-tab/properties/*), we prove the
// invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate arbitrary step
//      configurations with canProceed=false, and verify the disabled
//      state logic produces the correct visual classes (opacity-50,
//      pointer-events-none).
//
//   2. Source-level pins on `StepFooter.tsx` — verify the component
//      source applies the correct CSS classes when the button is
//      disabled, ensuring the visual contract is maintained.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Pure logic extracted from StepFooter component
// ---------------------------------------------------------------------------

/**
 * Determines the disabled visual state of the Continue button.
 * Mirrors the className logic in StepFooter.tsx:
 *   (!canProceed || isLoading) && "opacity-50 pointer-events-none"
 */
function getButtonDisabledState(
  canProceed: boolean,
  isLoading: boolean,
): {
  isDisabled: boolean;
  hasReducedOpacity: boolean;
  hasPointerEventsNone: boolean;
} {
  const isDisabled = !canProceed || isLoading;
  return {
    isDisabled,
    hasReducedOpacity: isDisabled,
    hasPointerEventsNone: isDisabled,
  };
}

/**
 * Determines the button label based on step position.
 * Mirrors the rendering logic in StepFooter.tsx.
 */
function getButtonLabel(
  step: number,
  totalSteps: number,
  isLoading: boolean,
): "spinner" | "Complete setup" | "Continue" {
  if (isLoading) return "spinner";
  if (step === totalSteps) return "Complete setup";
  return "Continue";
}

/**
 * Determines whether the HTML disabled attribute is set on the button.
 * Mirrors: disabled={!canProceed || isLoading}
 */
function getButtonHtmlDisabled(
  canProceed: boolean,
  isLoading: boolean,
): boolean {
  return !canProceed || isLoading;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary for a valid step number (1–4) */
const stepArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 4 });

/** Arbitrary for total steps (always 4 in this app, but test flexibility) */
const totalStepsArb: fc.Arbitrary<number> = fc.constant(4);

/** Arbitrary for a StepFooter configuration where canProceed is false */
const disabledStepFooterArb = fc.record({
  step: stepArb,
  totalSteps: totalStepsArb,
  canProceed: fc.constant(false),
  isLoading: fc.boolean(),
});

/** Arbitrary for a StepFooter configuration where isLoading is true */
const loadingStepFooterArb = fc.record({
  step: stepArb,
  totalSteps: totalStepsArb,
  canProceed: fc.boolean(),
  isLoading: fc.constant(true),
});

/** Arbitrary for any StepFooter configuration */
const anyStepFooterArb = fc.record({
  step: stepArb,
  totalSteps: totalStepsArb,
  canProceed: fc.boolean(),
  isLoading: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 14: Disabled Button State
// ---------------------------------------------------------------------------

describe("StepFooter — Property 14: Disabled Button State (Task 3.8)", () => {
  it("when canProceed is false, button renders at 50% opacity with pointer-events disabled", () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(disabledStepFooterArb, ({ step, totalSteps, canProceed, isLoading }) => {
        const state = getButtonDisabledState(canProceed, isLoading);

        // Requirement 5.5: disabled state renders at 50% opacity
        assert.strictEqual(
          state.hasReducedOpacity,
          true,
          `Button must have 50% opacity when canProceed=${canProceed} (step ${step})`,
        );

        // Requirement 5.5: disabled state has no pointer events
        assert.strictEqual(
          state.hasPointerEventsNone,
          true,
          `Button must have pointer-events-none when canProceed=${canProceed} (step ${step})`,
        );

        // The button must be marked as disabled
        assert.strictEqual(
          state.isDisabled,
          true,
          `Button must be disabled when canProceed=${canProceed} (step ${step})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("when isLoading is true, button renders at 50% opacity with pointer-events disabled", () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(loadingStepFooterArb, ({ step, totalSteps, canProceed, isLoading }) => {
        const state = getButtonDisabledState(canProceed, isLoading);

        // Loading state also triggers disabled visual treatment
        assert.strictEqual(
          state.hasReducedOpacity,
          true,
          `Button must have 50% opacity when isLoading=${isLoading} (step ${step})`,
        );

        assert.strictEqual(
          state.hasPointerEventsNone,
          true,
          `Button must have pointer-events-none when isLoading=${isLoading} (step ${step})`,
        );

        assert.strictEqual(
          state.isDisabled,
          true,
          `Button must be disabled when isLoading=${isLoading} (step ${step})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("when canProceed is true and isLoading is false, button is NOT disabled", () => {
    // **Validates: Requirements 5.5** (inverse — enabled state)
    fc.assert(
      fc.property(stepArb, totalStepsArb, (step, totalSteps) => {
        const canProceed = true;
        const isLoading = false;
        const state = getButtonDisabledState(canProceed, isLoading);

        // Button must NOT have disabled visual treatment
        assert.strictEqual(
          state.hasReducedOpacity,
          false,
          `Button must NOT have 50% opacity when canProceed=true and isLoading=false (step ${step})`,
        );

        assert.strictEqual(
          state.hasPointerEventsNone,
          false,
          `Button must NOT have pointer-events-none when canProceed=true and isLoading=false (step ${step})`,
        );

        assert.strictEqual(
          state.isDisabled,
          false,
          `Button must NOT be disabled when canProceed=true and isLoading=false (step ${step})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("disabled state is determined solely by canProceed and isLoading — step number is irrelevant", () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(anyStepFooterArb, ({ step, totalSteps, canProceed, isLoading }) => {
        const state = getButtonDisabledState(canProceed, isLoading);
        const expectedDisabled = !canProceed || isLoading;

        // The disabled state must be consistent regardless of step number
        assert.strictEqual(
          state.isDisabled,
          expectedDisabled,
          `Disabled state must equal (!canProceed || isLoading) = ${expectedDisabled} for step ${step}`,
        );

        // Opacity and pointer-events must always match the disabled state
        assert.strictEqual(
          state.hasReducedOpacity,
          expectedDisabled,
          `Opacity-50 must match disabled state (${expectedDisabled}) for step ${step}`,
        );
        assert.strictEqual(
          state.hasPointerEventsNone,
          expectedDisabled,
          `Pointer-events-none must match disabled state (${expectedDisabled}) for step ${step}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("HTML disabled attribute matches the visual disabled state", () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(anyStepFooterArb, ({ step, totalSteps, canProceed, isLoading }) => {
        const visualState = getButtonDisabledState(canProceed, isLoading);
        const htmlDisabled = getButtonHtmlDisabled(canProceed, isLoading);

        // HTML disabled and visual disabled must always agree
        assert.strictEqual(
          htmlDisabled,
          visualState.isDisabled,
          `HTML disabled (${htmlDisabled}) must match visual disabled state (${visualState.isDisabled})`,
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
// These verify the component source applies the correct CSS classes
// for the disabled state, ensuring the visual contract from
// Requirement 5.5 is maintained in the rendered output.

const COMPONENT_SOURCE = readFileSync(
  path.resolve(__dirname, "../StepFooter.tsx"),
  "utf8",
);

describe("StepFooter — source-level structural contracts (Req 5.5)", () => {
  it("applies opacity-50 class when button is disabled", () => {
    // Req 5.5: disabled state renders at 50% opacity
    assert.match(
      COMPONENT_SOURCE,
      /opacity-50/,
      "Disabled button must apply 'opacity-50' class (Req 5.5)",
    );
  });

  it("applies pointer-events-none class when button is disabled", () => {
    // Req 5.5: disabled state has no pointer events
    assert.match(
      COMPONENT_SOURCE,
      /pointer-events-none/,
      "Disabled button must apply 'pointer-events-none' class (Req 5.5)",
    );
  });

  it("disabled condition uses !canProceed || isLoading", () => {
    // The disabled logic must check both canProceed and isLoading
    assert.match(
      COMPONENT_SOURCE,
      /!canProceed\s*\|\|\s*isLoading/,
      "Disabled condition must use '!canProceed || isLoading'",
    );
  });

  it("opacity-50 and pointer-events-none are applied together in the same conditional", () => {
    // Req 5.5: both visual treatments must be applied as a unit
    assert.match(
      COMPONENT_SOURCE,
      /opacity-50\s+pointer-events-none/,
      "opacity-50 and pointer-events-none must be applied together (Req 5.5)",
    );
  });

  it("button has disabled HTML attribute set based on canProceed and isLoading", () => {
    // The button element must have a disabled attribute
    assert.match(
      COMPONENT_SOURCE,
      /disabled=\{!canProceed\s*\|\|\s*isLoading\}/,
      "Button must have disabled={!canProceed || isLoading} attribute",
    );
  });
});
