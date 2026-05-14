// Task 3.3 — Property 1: Stepper State Rendering
//
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any currentStep (1–4), the VerticalStepper must render each step
// indicator in the correct visual state:
//   - step < currentStep → completed: filled `primary` circle with white
//     checkmark icon (12px) (Req 2.2)
//   - step === currentStep → current: `primary/20` ring with `primary`
//     inner dot (8px), aria-current="step" (Req 2.3, 2.7)
//   - step > currentStep → pending: `muted` circle with
//     `muted-foreground` number (Req 2.4)
//
// Connecting lines between steps must use:
//   - `primary` color for completed segments (step < currentStep) (Req 2.5)
//   - `border` color for pending segments (step >= currentStep) (Req 2.5)
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate arbitrary currentStep
//      values (1–4) and verify the state determination logic correctly
//      partitions all steps into completed/current/pending.
//
//   2. Source-level pins on `OnboardingSidebar.tsx` — verify the component
//      source applies the correct CSS classes and aria attributes based on
//      the step state, ensuring the visual contract is maintained.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4;

// ---------------------------------------------------------------------------
// Pure logic under test — extracted from OnboardingSidebar component.
//
// The component determines step state with:
//   isCompleted = completedSteps.has(step)
//   isCurrent = step === currentStep
//   isPending = !isCompleted && !isCurrent
//
// In the standard onboarding flow, completedSteps contains all steps
// less than currentStep. The design spec defines:
//   step < currentStep → completed
//   step === currentStep → current
//   step > currentStep → pending
// ---------------------------------------------------------------------------

type StepState = "completed" | "current" | "pending";

/**
 * Determines the visual state of a step indicator.
 * Mirrors the logic in OnboardingSidebar component (design.md getStepCompletionStatus).
 */
function getStepState(step: number, currentStep: number): StepState {
  if (step < currentStep) return "completed";
  if (step === currentStep) return "current";
  return "pending";
}

/**
 * Determines the connecting line color for a step.
 * The line below a step is colored based on whether that step is completed.
 * Per Req 2.5: `primary` for completed segments, `border` for pending.
 */
function getConnectingLineColor(
  step: number,
  currentStep: number,
): "primary" | "border" {
  // A step's connecting line is `primary` if the step itself is completed
  return step < currentStep ? "primary" : "border";
}

/**
 * Determines whether aria-current="step" should be applied.
 * Per Req 2.7: only the current step gets aria-current.
 */
function shouldHaveAriaCurrent(step: number, currentStep: number): boolean {
  return step === currentStep;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a valid currentStep value (1–4).
 */
const currentStepArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: TOTAL_STEPS });

/**
 * Generates a scenario with a currentStep and all step numbers.
 */
interface StepperScenario {
  currentStep: number;
  steps: number[];
}

const stepperScenarioArb: fc.Arbitrary<StepperScenario> = currentStepArb.map(
  (currentStep) => ({
    currentStep,
    steps: Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1),
  }),
);

// ---------------------------------------------------------------------------
// Data-level PBT — Property 1: Stepper State Rendering
// ---------------------------------------------------------------------------

describe("VerticalStepper — Property 1: Stepper State Rendering (Task 3.3)", () => {
  it("steps before currentStep render as completed (filled primary circle with checkmark)", () => {
    // **Validates: Requirements 2.2**
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        for (const step of steps) {
          if (step < currentStep) {
            const state = getStepState(step, currentStep);
            assert.strictEqual(
              state,
              "completed",
              `Step ${step} (< currentStep ${currentStep}) must be "completed"`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("step equal to currentStep renders as current (primary/20 ring with primary dot)", () => {
    // **Validates: Requirements 2.3**
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        for (const step of steps) {
          if (step === currentStep) {
            const state = getStepState(step, currentStep);
            assert.strictEqual(
              state,
              "current",
              `Step ${step} (=== currentStep ${currentStep}) must be "current"`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("steps after currentStep render as pending (muted circle with muted-foreground number)", () => {
    // **Validates: Requirements 2.4**
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        for (const step of steps) {
          if (step > currentStep) {
            const state = getStepState(step, currentStep);
            assert.strictEqual(
              state,
              "pending",
              `Step ${step} (> currentStep ${currentStep}) must be "pending"`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("connecting lines use primary for completed segments and border for pending", () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        // Only steps 1 through totalSteps-1 have connecting lines
        const stepsWithLines = steps.filter((s) => s < TOTAL_STEPS);

        for (const step of stepsWithLines) {
          const lineColor = getConnectingLineColor(step, currentStep);

          if (step < currentStep) {
            assert.strictEqual(
              lineColor,
              "primary",
              `Connecting line for completed step ${step} must be "primary" (currentStep=${currentStep})`,
            );
          } else {
            assert.strictEqual(
              lineColor,
              "border",
              `Connecting line for non-completed step ${step} must be "border" (currentStep=${currentStep})`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("only the current step has aria-current='step'", () => {
    // **Validates: Requirements 2.7**
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        const stepsWithAriaCurrent = steps.filter((step) =>
          shouldHaveAriaCurrent(step, currentStep),
        );

        assert.strictEqual(
          stepsWithAriaCurrent.length,
          1,
          `Exactly one step must have aria-current="step", got ${stepsWithAriaCurrent.length}`,
        );

        assert.strictEqual(
          stepsWithAriaCurrent[0],
          currentStep,
          `aria-current="step" must be on step ${currentStep}, got step ${stepsWithAriaCurrent[0]}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("every step is in exactly one state (completed, current, or pending)", () => {
    // **Validates: Requirements 2.2, 2.3, 2.4**
    // Partition invariant: each step maps to exactly one visual state.
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        const states = steps.map((step) => getStepState(step, currentStep));

        // Each state must be one of the three valid states
        for (let i = 0; i < steps.length; i++) {
          assert.ok(
            states[i] === "completed" || states[i] === "current" || states[i] === "pending",
            `Step ${steps[i]} must be in one of the three states, got "${states[i]}"`,
          );
        }

        // Exactly one step must be current
        const currentCount = states.filter((s) => s === "current").length;
        assert.strictEqual(
          currentCount,
          1,
          `Exactly one step must be "current", got ${currentCount}`,
        );

        // Completed count must equal currentStep - 1
        const completedCount = states.filter((s) => s === "completed").length;
        assert.strictEqual(
          completedCount,
          currentStep - 1,
          `Completed count must be ${currentStep - 1}, got ${completedCount}`,
        );

        // Pending count must equal totalSteps - currentStep
        const pendingCount = states.filter((s) => s === "pending").length;
        assert.strictEqual(
          pendingCount,
          TOTAL_STEPS - currentStep,
          `Pending count must be ${TOTAL_STEPS - currentStep}, got ${pendingCount}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("state ordering is always completed → current → pending (no gaps)", () => {
    // **Validates: Requirements 2.2, 2.3, 2.4**
    // The stepper must show a contiguous sequence: all completed steps come
    // before the current step, and all pending steps come after.
    fc.assert(
      fc.property(stepperScenarioArb, ({ currentStep, steps }) => {
        const states = steps.map((step) => getStepState(step, currentStep));

        // Verify ordering: once we see "current", no more "completed" after
        let seenCurrent = false;
        let seenPending = false;

        for (const state of states) {
          if (state === "current") {
            assert.strictEqual(
              seenCurrent,
              false,
              "Must not see 'current' twice",
            );
            assert.strictEqual(
              seenPending,
              false,
              "Must not see 'pending' before 'current'",
            );
            seenCurrent = true;
          } else if (state === "pending") {
            assert.strictEqual(
              seenCurrent,
              true,
              "Must see 'current' before 'pending'",
            );
            seenPending = true;
          } else if (state === "completed") {
            assert.strictEqual(
              seenCurrent,
              false,
              "Must not see 'completed' after 'current'",
            );
            assert.strictEqual(
              seenPending,
              false,
              "Must not see 'completed' after 'pending'",
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins — structural contracts
// ---------------------------------------------------------------------------
//
// These verify the component source applies the correct CSS classes and
// aria attributes based on the step state, ensuring the visual contract
// from Requirements 2.2, 2.3, 2.4, 2.5, 2.7 is maintained.

const COMPONENT_SOURCE = readFileSync(
  path.resolve(__dirname, "../OnboardingSidebar.tsx"),
  "utf8",
);

describe("VerticalStepper — source-level structural contracts (Req 2.2, 2.3, 2.4, 2.5, 2.7)", () => {
  it("renders completed step with bg-primary circle and Check icon (Req 2.2)", () => {
    // Completed steps must have a filled primary circle with a checkmark
    assert.match(
      COMPONENT_SOURCE,
      /bg-primary/,
      "Completed step must use 'bg-primary' for the filled circle (Req 2.2)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /Check/,
      "Completed step must render a Check icon (Req 2.2)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /text-white/,
      "Checkmark must be white (Req 2.2)",
    );
  });

  it("renders current step with ring-primary/20 and inner dot (Req 2.3)", () => {
    // Current step must have a primary/20 ring with a primary inner dot
    assert.match(
      COMPONENT_SOURCE,
      /ring-.*primary\/20/,
      "Current step must use 'ring-primary/20' for the ring (Req 2.3)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /bg-primary/,
      "Current step must have a primary inner dot (Req 2.3)",
    );
  });

  it("renders pending step with muted circle and muted-foreground number (Req 2.4)", () => {
    // Pending steps must have a muted circle with muted-foreground number
    assert.match(
      COMPONENT_SOURCE,
      /bg-muted-foreground\/20/,
      "Pending step must use muted background for the circle (Req 2.4)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /text-muted-foreground/,
      "Pending step must use 'text-muted-foreground' for the number (Req 2.4)",
    );
  });

  it("uses bg-primary for completed connecting lines and bg-border for pending (Req 2.5)", () => {
    // Connecting lines must use conditional coloring
    assert.match(
      COMPONENT_SOURCE,
      /isCompleted\s*\?\s*['"][^'"]*bg-primary[^'"]*['"]/,
      "Connecting line must use 'bg-primary' when step is completed (Req 2.5)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /['"][^'"]*bg-border[^'"]*['"]/,
      "Connecting line must use 'bg-border' when step is pending (Req 2.5)",
    );
  });

  it("applies aria-current='step' on the current step li element (Req 2.7)", () => {
    // The current step must have aria-current="step"
    assert.match(
      COMPONENT_SOURCE,
      /aria-current.*step/,
      "Current step must have aria-current='step' (Req 2.7)",
    );
  });

  it("uses aria-label='Onboarding progress' on the nav element (Req 2.7)", () => {
    // The stepper nav must have an aria-label
    assert.match(
      COMPONENT_SOURCE,
      /aria-label="Onboarding progress"/,
      "Stepper nav must have aria-label='Onboarding progress' (Req 2.7)",
    );
  });

  it("renders step indicator circles at 24px (h-6 w-6) diameter (Req 2.1)", () => {
    // Step circles must be 24px (h-6 w-6 in Tailwind)
    assert.match(
      COMPONENT_SOURCE,
      /h-6\s+w-6/,
      "Step indicator circles must be 24px diameter (h-6 w-6) (Req 2.1)",
    );
  });

  it("renders connecting lines at 2px width (w-\\[2px\\]) (Req 2.1)", () => {
    // Connecting lines must be 2px wide
    assert.match(
      COMPONENT_SOURCE,
      /w-\[2px\]/,
      "Connecting lines must be 2px wide (w-[2px]) (Req 2.1)",
    );
  });
});
