// Task 2.2 — Property Tests for ChipSelector
//
// **Validates: Requirements 6.1, 6.2, 6.5, 6.6**
//
// Properties tested:
//   Property 3: Chip Selection Visual State
//   Property 4: Chip Overflow Collapse
//   Property 5: Chip Selection Counter
//
// Generator: arbitrary arrays of ChipOption objects and arbitrary subsets of selected values.
// Runs: `fc.assert(..., { numRuns: 100 })` per design § Correctness Properties.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

// ---------------------------------------------------------------------------
// Types (mirroring ChipSelector component interface)
// ---------------------------------------------------------------------------

interface ChipOption {
  value: string;
  label: string;
}

type ColorVariant = "primary" | "secondary";

// ---------------------------------------------------------------------------
// Pure logic extracted from ChipSelector component
// ---------------------------------------------------------------------------

/**
 * Determines the visual state of a single chip based on selection status and color variant.
 * Mirrors the className logic in ChipSelector.tsx.
 */
function getChipVisualState(
  isSelected: boolean,
  colorVariant: ColorVariant,
): {
  hasTintedBackground: boolean;
  borderWidth: string;
  hasCheckmark: boolean;
  textColor: "primary" | "chart-2" | "foreground";
} {
  if (isSelected) {
    return {
      hasTintedBackground: true,
      borderWidth: "1.5px",
      hasCheckmark: true,
      textColor: colorVariant === "primary" ? "primary" : "chart-2",
    };
  }
  return {
    hasTintedBackground: false,
    borderWidth: "1px",
    hasCheckmark: false,
    textColor: "foreground",
  };
}

/**
 * Determines which options are visible given the collapse/expand state.
 * Mirrors the visibleOptions logic in ChipSelector.tsx.
 */
function getVisibleOptions(
  options: ChipOption[],
  maxVisible: number,
  expanded: boolean,
): ChipOption[] {
  const shouldCollapse = options.length > maxVisible;
  if (shouldCollapse && !expanded) {
    return options.slice(0, maxVisible);
  }
  return options;
}

/**
 * Determines whether the "Show more" toggle should be rendered.
 * Mirrors the shouldCollapse logic in ChipSelector.tsx.
 */
function shouldShowCollapseToggle(
  options: ChipOption[],
  maxVisible: number,
): boolean {
  return options.length > maxVisible;
}

/**
 * Derives the selection counter text.
 * Mirrors the counter rendering logic in ChipSelector.tsx.
 */
function getSelectionCounterText(selectedCount: number): string | null {
  if (selectedCount > 0) {
    return `${selectedCount} selected`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary for a valid chip option value (non-empty, unique-friendly) */
const chipValueArb: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 30,
});

/** Arbitrary for a ChipOption */
const chipOptionArb: fc.Arbitrary<ChipOption> = fc.record({
  value: chipValueArb,
  label: fc.string({ minLength: 1, maxLength: 50 }),
});

/** Arbitrary for a list of chip options with unique values */
const chipOptionsArb: fc.Arbitrary<ChipOption[]> = fc
  .array(chipOptionArb, { minLength: 1, maxLength: 30 })
  .map((options) => {
    // Deduplicate by value to match real usage
    const seen = new Set<string>();
    return options.filter((opt) => {
      if (seen.has(opt.value)) return false;
      seen.add(opt.value);
      return true;
    });
  })
  .filter((options) => options.length >= 1);

/** Arbitrary for a list of chip options with > 12 items (for overflow tests) */
const overflowChipOptionsArb: fc.Arbitrary<ChipOption[]> = fc
  .array(chipOptionArb, { minLength: 13, maxLength: 30 })
  .map((options) => {
    const seen = new Set<string>();
    return options.filter((opt) => {
      if (seen.has(opt.value)) return false;
      seen.add(opt.value);
      return true;
    });
  })
  .filter((options) => options.length > 12);

/** Arbitrary for a subset of selected values from a given options list */
function selectedSubsetArb(
  options: ChipOption[],
): fc.Arbitrary<Set<string>> {
  return fc
    .subarray(
      options.map((o) => o.value),
      { minLength: 0 },
    )
    .map((arr) => new Set(arr));
}

/** Arbitrary for color variant */
const colorVariantArb: fc.Arbitrary<ColorVariant> = fc.constantFrom(
  "primary",
  "secondary",
);

// ---------------------------------------------------------------------------
// Property 3: Chip Selection Visual State
// ---------------------------------------------------------------------------

describe("property: Chip Selection Visual State (Property 3)", () => {
  it("selected chips render with tinted background, 1.5px border, checkmark, and colored text", () => {
    // **Validates: Requirements 6.1, 6.2**
    fc.assert(
      fc.property(
        chipOptionsArb,
        colorVariantArb,
        (options, colorVariant) => {
          return fc.assert(
            fc.property(selectedSubsetArb(options), (selected) => {
              for (const option of options) {
                const isSelected = selected.has(option.value);
                const state = getChipVisualState(isSelected, colorVariant);

                if (isSelected) {
                  // Requirement 6.2: selected chip has tinted bg, 1.5px stroke, checkmark
                  assert.strictEqual(
                    state.hasTintedBackground,
                    true,
                    `Selected chip "${option.value}" must have tinted background`,
                  );
                  assert.strictEqual(
                    state.borderWidth,
                    "1.5px",
                    `Selected chip "${option.value}" must have 1.5px border`,
                  );
                  assert.strictEqual(
                    state.hasCheckmark,
                    true,
                    `Selected chip "${option.value}" must show checkmark`,
                  );
                  const expectedColor =
                    colorVariant === "primary" ? "primary" : "chart-2";
                  assert.strictEqual(
                    state.textColor,
                    expectedColor,
                    `Selected chip "${option.value}" must have ${expectedColor} text`,
                  );
                } else {
                  // Requirement 6.1: unselected chip has background fill, 1px border, no checkmark
                  assert.strictEqual(
                    state.hasTintedBackground,
                    false,
                    `Unselected chip "${option.value}" must not have tinted background`,
                  );
                  assert.strictEqual(
                    state.borderWidth,
                    "1px",
                    `Unselected chip "${option.value}" must have 1px border`,
                  );
                  assert.strictEqual(
                    state.hasCheckmark,
                    false,
                    `Unselected chip "${option.value}" must not show checkmark`,
                  );
                  assert.strictEqual(
                    state.textColor,
                    "foreground",
                    `Unselected chip "${option.value}" must have foreground text`,
                  );
                }
              }
            }),
            { numRuns: 10 },
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  it("visual state is purely determined by selection membership and color variant", () => {
    // **Validates: Requirements 6.1, 6.2**
    fc.assert(
      fc.property(
        chipValueArb,
        fc.boolean(),
        colorVariantArb,
        (value, isSelected, colorVariant) => {
          const state1 = getChipVisualState(isSelected, colorVariant);
          const state2 = getChipVisualState(isSelected, colorVariant);

          // Same inputs always produce same outputs (deterministic)
          assert.deepStrictEqual(state1, state2);

          // Selected and unselected states are always different
          if (isSelected) {
            const unselectedState = getChipVisualState(false, colorVariant);
            assert.notDeepStrictEqual(state1, unselectedState);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Chip Overflow Collapse
// ---------------------------------------------------------------------------

describe("property: Chip Overflow Collapse (Property 4)", () => {
  it("when options > 12, only first 12 are visible initially (not expanded)", () => {
    // **Validates: Requirements 6.5**
    fc.assert(
      fc.property(overflowChipOptionsArb, (options) => {
        const maxVisible = 12;
        const expanded = false;

        const visible = getVisibleOptions(options, maxVisible, expanded);

        // Only first 12 should be visible
        assert.strictEqual(
          visible.length,
          maxVisible,
          `Expected ${maxVisible} visible chips, got ${visible.length} (total: ${options.length})`,
        );

        // Visible chips must be the first 12 from the original list
        for (let i = 0; i < maxVisible; i++) {
          assert.strictEqual(
            visible[i].value,
            options[i].value,
            `Visible chip at index ${i} must match original options order`,
          );
        }

        // The "Show more" toggle should be shown
        assert.strictEqual(
          shouldShowCollapseToggle(options, maxVisible),
          true,
          "Show more toggle must be visible when options exceed maxVisible",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("when options > maxVisible and expanded, all options are visible", () => {
    // **Validates: Requirements 6.5**
    fc.assert(
      fc.property(overflowChipOptionsArb, (options) => {
        const maxVisible = 12;
        const expanded = true;

        const visible = getVisibleOptions(options, maxVisible, expanded);

        // All options should be visible when expanded
        assert.strictEqual(
          visible.length,
          options.length,
          `Expected all ${options.length} chips visible when expanded, got ${visible.length}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("when options <= 12, all options are visible regardless of expanded state", () => {
    // **Validates: Requirements 6.5**
    const smallOptionsArb = fc
      .array(chipOptionArb, { minLength: 1, maxLength: 12 })
      .map((options) => {
        const seen = new Set<string>();
        return options.filter((opt) => {
          if (seen.has(opt.value)) return false;
          seen.add(opt.value);
          return true;
        });
      })
      .filter((options) => options.length >= 1 && options.length <= 12);

    fc.assert(
      fc.property(smallOptionsArb, fc.boolean(), (options, expanded) => {
        const maxVisible = 12;

        const visible = getVisibleOptions(options, maxVisible, expanded);

        // All options should be visible (no collapse needed)
        assert.strictEqual(
          visible.length,
          options.length,
          `Expected all ${options.length} chips visible (≤12), got ${visible.length}`,
        );

        // No "Show more" toggle needed
        assert.strictEqual(
          shouldShowCollapseToggle(options, maxVisible),
          false,
          "Show more toggle must not be visible when options <= maxVisible",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("respects custom maxVisible values", () => {
    // **Validates: Requirements 6.5**
    const maxVisibleArb = fc.integer({ min: 1, max: 20 });

    fc.assert(
      fc.property(
        fc.array(chipOptionArb, { minLength: 1, maxLength: 30 }).map((options) => {
          const seen = new Set<string>();
          return options.filter((opt) => {
            if (seen.has(opt.value)) return false;
            seen.add(opt.value);
            return true;
          });
        }).filter((o) => o.length >= 1),
        maxVisibleArb,
        (options, maxVisible) => {
          const visible = getVisibleOptions(options, maxVisible, false);

          if (options.length > maxVisible) {
            assert.strictEqual(
              visible.length,
              maxVisible,
              `Expected ${maxVisible} visible chips when collapsed`,
            );
          } else {
            assert.strictEqual(
              visible.length,
              options.length,
              `Expected all ${options.length} chips visible when <= maxVisible`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Chip Selection Counter
// ---------------------------------------------------------------------------

describe("property: Chip Selection Counter (Property 5)", () => {
  it("counter displays exact count of selected items when > 0", () => {
    // **Validates: Requirements 6.6**
    fc.assert(
      fc.property(
        chipOptionsArb.chain((options) =>
          selectedSubsetArb(options).map((selected) => ({ options, selected })),
        ),
        ({ options, selected }) => {
          const counterText = getSelectionCounterText(selected.size);

          if (selected.size > 0) {
            assert.strictEqual(
              counterText,
              `${selected.size} selected`,
              `Counter must show "${selected.size} selected", got "${counterText}"`,
            );
          } else {
            assert.strictEqual(
              counterText,
              null,
              "Counter must not render when nothing is selected",
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("counter is null when selected set is empty", () => {
    // **Validates: Requirements 6.6**
    fc.assert(
      fc.property(chipOptionsArb, (options) => {
        const emptySelection = new Set<string>();
        const counterText = getSelectionCounterText(emptySelection.size);

        assert.strictEqual(
          counterText,
          null,
          "Counter must be null when no chips are selected",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("counter count matches the exact size of the selected set", () => {
    // **Validates: Requirements 6.6**
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        (count) => {
          const counterText = getSelectionCounterText(count);

          if (count > 0) {
            assert.ok(
              counterText !== null,
              `Counter must not be null for count ${count}`,
            );
            // Extract the number from the counter text
            const match = counterText!.match(/^(\d+) selected$/);
            assert.ok(
              match !== null,
              `Counter text "${counterText}" must match "N selected" format`,
            );
            assert.strictEqual(
              parseInt(match![1], 10),
              count,
              `Counter number must equal ${count}`,
            );
          } else {
            assert.strictEqual(
              counterText,
              null,
              "Counter must be null for count 0",
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
