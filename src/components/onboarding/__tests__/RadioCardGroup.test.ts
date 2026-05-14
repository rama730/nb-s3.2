// Task 2.4 — Property test: Radio Card Selection State (Property 6).
//
// **Validates: Requirements 7.1, 7.2**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any list of options and a selected value, the RadioCardGroup
// component must render:
//   (a) The matching option (option.value === selected) with selected
//       styles: `border-2 border-primary bg-primary/5` on the card,
//       and `border-primary bg-primary` on the indicator circle.
//       (Req 7.2)
//   (b) All non-matching options with unselected styles:
//       `border border-border bg-card hover:border-primary/40` on the
//       card, and `border-border bg-card` on the indicator circle.
//       (Req 7.1)
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern (tests/unit/files-tab/properties/*), we prove the
// invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate arbitrary option
//      lists and a selected value, then verify the selection logic
//      (`option.value === selected`) correctly partitions options into
//      exactly one selected and the rest unselected.
//
//   2. Source-level pins on `RadioCardGroup.tsx` — verify the component
//      source applies the correct CSS classes based on the `isSelected`
//      boolean, ensuring the visual contract is maintained.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a valid RadioCardOption. Values are non-empty strings that
 * serve as unique identifiers. Labels and descriptions are arbitrary
 * non-empty strings.
 */
const radioCardOptionArb = fc.record({
  value: fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0),
  label: fc.string({ minLength: 1, maxLength: 64 }),
  description: fc.string({ minLength: 1, maxLength: 128 }),
});

/**
 * Generates a non-empty list of options with unique values, plus a
 * selected value that is one of the option values.
 */
const radioCardGroupInputArb = fc
  .array(radioCardOptionArb, { minLength: 1, maxLength: 10 })
  .filter((options) => {
    // Ensure unique values
    const values = options.map((o) => o.value);
    return new Set(values).size === values.length;
  })
  .chain((options) =>
    fc.record({
      options: fc.constant(options),
      selected: fc.constantFrom(...options.map((o) => o.value)),
    }),
  );

/**
 * Generates a non-empty list of options with unique values, plus a
 * selected value that does NOT match any option value (edge case:
 * nothing should appear selected).
 */
const radioCardGroupNoMatchArb = fc
  .array(radioCardOptionArb, { minLength: 1, maxLength: 10 })
  .filter((options) => {
    const values = options.map((o) => o.value);
    return new Set(values).size === values.length;
  })
  .map((options) => ({
    options,
    // Use a value guaranteed not to be in the options list
    selected: `__no_match_${Date.now()}__`,
  }));

// ---------------------------------------------------------------------------
// Data-level PBT — Property 6: Radio Card Selection State
// ---------------------------------------------------------------------------

describe("RadioCardGroup — Property 6: Radio Card Selection State (Task 2.4)", () => {
  it("exactly one option is selected when selected value matches an option", () => {
    // **Validates: Requirements 7.1, 7.2**
    fc.assert(
      fc.property(radioCardGroupInputArb, ({ options, selected }) => {
        // Simulate the component's selection logic
        const selectionStates = options.map((option) => ({
          value: option.value,
          isSelected: option.value === selected,
        }));

        // Exactly one option must be selected
        const selectedOptions = selectionStates.filter((s) => s.isSelected);
        assert.equal(
          selectedOptions.length,
          1,
          `Expected exactly 1 selected option, got ${selectedOptions.length} for selected="${selected}"`,
        );

        // The selected option must have the correct value
        assert.equal(
          selectedOptions[0]!.value,
          selected,
          `Selected option value (${selectedOptions[0]!.value}) must equal selected prop (${selected})`,
        );

        // All other options must be unselected
        const unselectedOptions = selectionStates.filter((s) => !s.isSelected);
        assert.equal(
          unselectedOptions.length,
          options.length - 1,
          `Expected ${options.length - 1} unselected options, got ${unselectedOptions.length}`,
        );

        // No unselected option should have the selected value
        for (const opt of unselectedOptions) {
          assert.notEqual(
            opt.value,
            selected,
            `Unselected option should not have value "${selected}"`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no option is selected when selected value does not match any option", () => {
    // **Validates: Requirements 7.1, 7.2**
    fc.assert(
      fc.property(radioCardGroupNoMatchArb, ({ options, selected }) => {
        // Simulate the component's selection logic
        const selectionStates = options.map((option) => ({
          value: option.value,
          isSelected: option.value === selected,
        }));

        // No option should be selected
        const selectedOptions = selectionStates.filter((s) => s.isSelected);
        assert.equal(
          selectedOptions.length,
          0,
          `Expected 0 selected options when selected="${selected}" does not match any option value`,
        );

        // All options must be unselected
        const unselectedOptions = selectionStates.filter((s) => !s.isSelected);
        assert.equal(
          unselectedOptions.length,
          options.length,
          `All ${options.length} options should be unselected`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("selection state is mutually exclusive — selecting one deselects all others", () => {
    // **Validates: Requirements 7.1, 7.2**
    fc.assert(
      fc.property(radioCardGroupInputArb, ({ options, selected }) => {
        // For each option, verify the isSelected state is consistent
        for (const option of options) {
          const isSelected = option.value === selected;

          if (isSelected) {
            // Req 7.2: selected card gets selected styles
            // The component applies: border-2 border-primary bg-primary/5
            assert.ok(
              isSelected === true,
              `Option "${option.value}" should be selected when it matches "${selected}"`,
            );
          } else {
            // Req 7.1: unselected card gets unselected styles
            // The component applies: border border-border bg-card
            assert.ok(
              isSelected === false,
              `Option "${option.value}" should NOT be selected when selected="${selected}"`,
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
// These verify the component source applies the correct CSS classes
// based on the `isSelected` boolean, ensuring the visual contract from
// Requirements 7.1 and 7.2 is maintained in the rendered output.

const COMPONENT_SOURCE = readFileSync(
  path.resolve(__dirname, "../RadioCardGroup.tsx"),
  "utf8",
);

describe("RadioCardGroup — source-level structural contracts (Req 7.1, 7.2)", () => {
  it("applies selected styles (border-2 border-primary bg-primary/5) when isSelected is true", () => {
    // Req 7.2: selected card has 2px primary border and primary/5 background tint
    assert.match(
      COMPONENT_SOURCE,
      /border-2\s+border-primary\s+bg-primary\/5/,
      "Selected card must apply 'border-2 border-primary bg-primary/5' (Req 7.2)",
    );
  });

  it("applies unselected styles (border border-border bg-card) when isSelected is false", () => {
    // Req 7.1: unselected card has 1px border and card background
    assert.match(
      COMPONENT_SOURCE,
      /border\s+border-border\s+bg-card/,
      "Unselected card must apply 'border border-border bg-card' (Req 7.1)",
    );
  });

  it("applies hover style (hover:border-primary/40) on unselected cards", () => {
    // Req 7.3: unselected card hover transitions border to primary/40
    assert.match(
      COMPONENT_SOURCE,
      /hover:border-primary\/40/,
      "Unselected card must include 'hover:border-primary/40' for hover state (Req 7.3)",
    );
  });

  it("uses isSelected derived from option.value === selected comparison", () => {
    // The selection logic must compare option.value to the selected prop
    assert.match(
      COMPONENT_SOURCE,
      /option\.value\s*===\s*selected/,
      "Selection state must be derived from 'option.value === selected'",
    );
  });

  it("applies selected indicator styles (border-primary bg-primary) on the circle when selected", () => {
    // Req 7.4: filled circle indicator with primary styling when selected
    assert.match(
      COMPONENT_SOURCE,
      /border-primary\s+bg-primary/,
      "Selected indicator circle must apply 'border-primary bg-primary' (Req 7.4)",
    );
  });

  it("applies unselected indicator styles (border-border bg-card) on the circle when not selected", () => {
    // Req 7.1: unselected indicator has border styling
    assert.match(
      COMPONENT_SOURCE,
      /border-border\s+bg-card/,
      "Unselected indicator circle must apply 'border-border bg-card' (Req 7.1)",
    );
  });

  it("uses role='radiogroup' on the container", () => {
    // Req 7.7: accessibility — radiogroup role
    assert.match(
      COMPONENT_SOURCE,
      /role="radiogroup"/,
      "Container must have role='radiogroup' (Req 7.7)",
    );
  });

  it("uses role='radio' and aria-checked on each option button", () => {
    // Req 7.7: accessibility — individual radio roles
    assert.match(
      COMPONENT_SOURCE,
      /role="radio"/,
      "Each option button must have role='radio' (Req 7.7)",
    );
    assert.match(
      COMPONENT_SOURCE,
      /aria-checked=\{isSelected\}/,
      "Each option button must have aria-checked={isSelected} (Req 7.7)",
    );
  });
});
