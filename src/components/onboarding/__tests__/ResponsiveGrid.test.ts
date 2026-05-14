// Task 9.2 — Property 16: Responsive Grid Collapse
//
// **Validates: Requirements 14.3**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any 2-column grid in the onboarding flow, the grid MUST use the
// `grid-cols-1 md:grid-cols-2` pattern. This ensures:
//   - Below 768px (< md breakpoint): single-column layout (grid-cols-1)
//   - At 768px and above (≥ md breakpoint): two-column layout (grid-cols-2)
//
// Tailwind's `md:` prefix maps to `@media (min-width: 768px)`, so
// `grid-cols-1` is the default (mobile-first) and `md:grid-cols-2`
// activates only at ≥768px. This guarantees collapse below 768px.
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate arbitrary viewport
//      widths and verify the grid column logic correctly determines
//      single vs. two-column layout based on the 768px breakpoint.
//
//   2. Source-level pins on `Step2Details.tsx` — verify that all grid
//      elements in the component use the `grid-cols-1 md:grid-cols-2`
//      pattern, ensuring they collapse to single column below 768px.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MD_BREAKPOINT = 768;

// ---------------------------------------------------------------------------
// Pure logic under test — responsive grid column determination
//
// The Tailwind classes `grid grid-cols-1 md:grid-cols-2` encode the
// following responsive behavior:
//   - Default (all viewports): 1 column
//   - md breakpoint (≥768px): 2 columns
//
// This function models the responsive behavior for testing.
// ---------------------------------------------------------------------------

/**
 * Determines the number of grid columns based on viewport width.
 * Models the behavior of `grid-cols-1 md:grid-cols-2` in Tailwind CSS.
 *
 * @param viewportWidth - The viewport width in pixels
 * @returns The number of columns the grid should display
 */
function getGridColumns(viewportWidth: number): 1 | 2 {
  if (viewportWidth >= MD_BREAKPOINT) {
    return 2;
  }
  return 1;
}

/**
 * Determines whether a grid should collapse to single column.
 * A grid collapses when viewport is below the md breakpoint (768px).
 *
 * @param viewportWidth - The viewport width in pixels
 * @returns true if the grid should be single-column (collapsed)
 */
function shouldCollapseToSingleColumn(viewportWidth: number): boolean {
  return viewportWidth < MD_BREAKPOINT;
}

/**
 * Validates that a Tailwind grid class string implements the correct
 * responsive collapse pattern (grid-cols-1 as default, md:grid-cols-2
 * for desktop).
 *
 * @param classString - The className string from a grid element
 * @returns true if the class string implements the responsive pattern
 */
function hasResponsiveGridPattern(classString: string): boolean {
  const hasGrid = classString.includes("grid");
  const hasDefaultSingleCol = classString.includes("grid-cols-1");
  const hasMdTwoCol = classString.includes("md:grid-cols-2");
  return hasGrid && hasDefaultSingleCol && hasMdTwoCol;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates viewport widths below the md breakpoint (mobile).
 * Range: 320px (minimum mobile) to 767px (just below md).
 */
const mobileViewportArb: fc.Arbitrary<number> = fc.integer({ min: 320, max: 767 });

/**
 * Generates viewport widths at or above the md breakpoint (desktop/tablet).
 * Range: 768px (md breakpoint) to 2560px (large desktop).
 */
const desktopViewportArb: fc.Arbitrary<number> = fc.integer({ min: 768, max: 2560 });

/**
 * Generates any valid viewport width.
 * Range: 320px (minimum mobile) to 2560px (large desktop).
 */
const anyViewportArb: fc.Arbitrary<number> = fc.integer({ min: 320, max: 2560 });

/**
 * Generates grid section identifiers from Step2Details.
 * These represent the 2-column grids in the component.
 */
const gridSectionArb: fc.Arbitrary<string> = fc.constantFrom(
  "experience-hours", // Experience level + Hours per week grid
  "location-website", // Location + Website grid
);

/**
 * Generates a scenario combining a viewport width and grid section.
 */
interface GridScenario {
  viewportWidth: number;
  gridSection: string;
}

const mobileGridScenarioArb: fc.Arbitrary<GridScenario> = fc.record({
  viewportWidth: mobileViewportArb,
  gridSection: gridSectionArb,
});

const desktopGridScenarioArb: fc.Arbitrary<GridScenario> = fc.record({
  viewportWidth: desktopViewportArb,
  gridSection: gridSectionArb,
});

const anyGridScenarioArb: fc.Arbitrary<GridScenario> = fc.record({
  viewportWidth: anyViewportArb,
  gridSection: gridSectionArb,
});

// ---------------------------------------------------------------------------
// Data-level PBT — Property 16: Responsive Grid Collapse
// ---------------------------------------------------------------------------

describe("ResponsiveGrid — Property 16: Responsive Grid Collapse (Task 9.2)", () => {
  it("all viewports below 768px collapse to single column (Req 14.3)", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(mobileGridScenarioArb, ({ viewportWidth, gridSection }) => {
        const columns = getGridColumns(viewportWidth);
        assert.strictEqual(
          columns,
          1,
          `Grid "${gridSection}" at ${viewportWidth}px must be single-column (got ${columns} columns)`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("all viewports at or above 768px use two columns (Req 14.3)", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(desktopGridScenarioArb, ({ viewportWidth, gridSection }) => {
        const columns = getGridColumns(viewportWidth);
        assert.strictEqual(
          columns,
          2,
          `Grid "${gridSection}" at ${viewportWidth}px must be two-column (got ${columns} columns)`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("shouldCollapseToSingleColumn returns true for all widths < 768px", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(mobileViewportArb, (viewportWidth) => {
        assert.strictEqual(
          shouldCollapseToSingleColumn(viewportWidth),
          true,
          `Viewport ${viewportWidth}px (< 768) must collapse to single column`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("shouldCollapseToSingleColumn returns false for all widths >= 768px", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(desktopViewportArb, (viewportWidth) => {
        assert.strictEqual(
          shouldCollapseToSingleColumn(viewportWidth),
          false,
          `Viewport ${viewportWidth}px (>= 768) must NOT collapse to single column`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("the breakpoint boundary is exactly at 768px — 767px collapses, 768px does not", () => {
    // **Validates: Requirements 14.3**
    // Boundary test: verify the exact breakpoint behavior
    assert.strictEqual(
      getGridColumns(767),
      1,
      "767px must be single-column (below md breakpoint)",
    );
    assert.strictEqual(
      getGridColumns(768),
      2,
      "768px must be two-column (at md breakpoint)",
    );
    assert.strictEqual(
      shouldCollapseToSingleColumn(767),
      true,
      "767px must collapse",
    );
    assert.strictEqual(
      shouldCollapseToSingleColumn(768),
      false,
      "768px must NOT collapse",
    );
  });

  it("getGridColumns and shouldCollapseToSingleColumn are consistent for any viewport", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(anyViewportArb, (viewportWidth) => {
        const columns = getGridColumns(viewportWidth);
        const collapsed = shouldCollapseToSingleColumn(viewportWidth);

        // Single column ↔ collapsed
        if (collapsed) {
          assert.strictEqual(
            columns,
            1,
            `Collapsed state at ${viewportWidth}px must mean 1 column`,
          );
        } else {
          assert.strictEqual(
            columns,
            2,
            `Non-collapsed state at ${viewportWidth}px must mean 2 columns`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it("grid column count is deterministic — same viewport always yields same result", () => {
    // **Validates: Requirements 14.3**
    fc.assert(
      fc.property(anyViewportArb, (viewportWidth) => {
        const result1 = getGridColumns(viewportWidth);
        const result2 = getGridColumns(viewportWidth);
        assert.strictEqual(
          result1,
          result2,
          `getGridColumns(${viewportWidth}) must be deterministic`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("hasResponsiveGridPattern validates the correct Tailwind class pattern", () => {
    // **Validates: Requirements 14.3**
    // Valid patterns
    assert.strictEqual(
      hasResponsiveGridPattern("grid grid-cols-1 md:grid-cols-2 gap-4"),
      true,
      "Standard responsive grid pattern must be recognized",
    );
    assert.strictEqual(
      hasResponsiveGridPattern("grid grid-cols-1 md:grid-cols-2"),
      true,
      "Minimal responsive grid pattern must be recognized",
    );

    // Invalid patterns — missing components
    assert.strictEqual(
      hasResponsiveGridPattern("grid grid-cols-2 gap-4"),
      false,
      "Grid without grid-cols-1 default must be rejected (no mobile collapse)",
    );
    assert.strictEqual(
      hasResponsiveGridPattern("grid grid-cols-1 gap-4"),
      false,
      "Grid without md:grid-cols-2 must be rejected (never expands)",
    );
    assert.strictEqual(
      hasResponsiveGridPattern("flex flex-col gap-4"),
      false,
      "Non-grid layout must be rejected",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins — structural contracts on Step2Details.tsx
// ---------------------------------------------------------------------------
//
// These verify the component source uses the correct responsive grid
// pattern (`grid grid-cols-1 md:grid-cols-2`) for all 2-column grids,
// ensuring they collapse to single column below 768px per Req 14.3.

const STEP2_SOURCE = readFileSync(
  path.resolve(__dirname, "../steps/Step2Details.tsx"),
  "utf8",
);

describe("ResponsiveGrid — source-level structural contracts (Req 14.3)", () => {
  it("Step2Details.tsx contains grid elements with responsive collapse pattern", () => {
    // **Validates: Requirements 14.3**
    const gridPattern = /grid\s+grid-cols-1\s+md:grid-cols-2/g;
    const matches = STEP2_SOURCE.match(gridPattern);
    assert.ok(
      matches && matches.length > 0,
      "Step2Details.tsx must contain at least one grid with `grid grid-cols-1 md:grid-cols-2` pattern",
    );
  });

  it("Step2Details.tsx has exactly 2 responsive grid instances (experience/hours + location/website)", () => {
    // **Validates: Requirements 14.3**
    const gridPattern = /grid-cols-1\s+md:grid-cols-2/g;
    const matches = STEP2_SOURCE.match(gridPattern);
    assert.ok(matches !== null, "Must find grid-cols-1 md:grid-cols-2 patterns");
    assert.strictEqual(
      matches!.length,
      2,
      `Expected exactly 2 responsive grid instances, found ${matches!.length}`,
    );
  });

  it("all grid-cols-2 usages in Step2Details.tsx are prefixed with md: (responsive)", () => {
    // **Validates: Requirements 14.3**
    // Find all grid-cols-2 occurrences and ensure they are all md: prefixed
    const allGridCols2 = STEP2_SOURCE.match(/(?<!\w)grid-cols-2/g) || [];
    const mdGridCols2 = STEP2_SOURCE.match(/md:grid-cols-2/g) || [];

    assert.strictEqual(
      allGridCols2.length,
      mdGridCols2.length,
      `All grid-cols-2 usages must be md: prefixed. Found ${allGridCols2.length} total but only ${mdGridCols2.length} with md: prefix. Non-prefixed grid-cols-2 would not collapse on mobile.`,
    );
  });

  it("all responsive grids use grid-cols-1 as the default (mobile-first)", () => {
    // **Validates: Requirements 14.3**
    // Every line with md:grid-cols-2 must also have grid-cols-1
    const lines = STEP2_SOURCE.split("\n");
    const gridLines = lines.filter((line) => line.includes("md:grid-cols-2"));

    assert.ok(
      gridLines.length > 0,
      "Must find lines with md:grid-cols-2",
    );

    for (const line of gridLines) {
      assert.ok(
        line.includes("grid-cols-1"),
        `Line with md:grid-cols-2 must also have grid-cols-1 as default: "${line.trim()}"`,
      );
    }
  });

  it("responsive grids use the 'grid' display class", () => {
    // **Validates: Requirements 14.3**
    const lines = STEP2_SOURCE.split("\n");
    const gridLines = lines.filter((line) => line.includes("md:grid-cols-2"));

    for (const line of gridLines) {
      // The line (or className string) must include "grid" as a class
      assert.match(
        line,
        /\bgrid\b/,
        `Line with md:grid-cols-2 must include 'grid' display class: "${line.trim()}"`,
      );
    }
  });

  it("no hardcoded non-responsive multi-column grids exist in Step2Details.tsx", () => {
    // **Validates: Requirements 14.3**
    // Ensure there are no grid-cols-2 or grid-cols-3 without a responsive prefix
    const lines = STEP2_SOURCE.split("\n");

    for (const line of lines) {
      // Skip comment lines
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      // Check for non-responsive multi-column grids
      if (line.includes("grid-cols-2") && !line.includes("md:grid-cols-2")) {
        assert.fail(
          `Found non-responsive grid-cols-2 (no md: prefix) which won't collapse on mobile: "${line.trim()}"`,
        );
      }
      if (line.includes("grid-cols-3") && !line.match(/[a-z]+:grid-cols-3/)) {
        assert.fail(
          `Found non-responsive grid-cols-3 (no breakpoint prefix) which won't collapse on mobile: "${line.trim()}"`,
        );
      }
    }
  });

  it("the experience/hours grid section uses responsive pattern (Work section)", () => {
    // **Validates: Requirements 14.3**
    // Verify the specific grid for experience level + hours per week
    assert.match(
      STEP2_SOURCE,
      /Experience level[\s\S]*?grid\s+grid-cols-1\s+md:grid-cols-2/,
      "Experience level / Hours per week section must use responsive grid pattern",
    );
  });

  it("the location/website grid section uses responsive pattern (Profile section)", () => {
    // **Validates: Requirements 14.3**
    // Verify the specific grid for location + website
    assert.match(
      STEP2_SOURCE,
      /Location[\s\S]*?grid\s+grid-cols-1\s+md:grid-cols-2|grid\s+grid-cols-1\s+md:grid-cols-2[\s\S]*?location/i,
      "Location / Website section must use responsive grid pattern",
    );
  });
});
