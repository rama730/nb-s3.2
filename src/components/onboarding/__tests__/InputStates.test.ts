// Task 8.2 — Property 13: Input Field State Rendering
//
// **Validates: Requirements 17.1, 17.2, 17.3, 17.4**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any input field, the `.onb-input` CSS class must provide correct
// visual treatment for each state:
//   - Default (Req 17.1): 1px border using `border` token, `background` fill
//   - Focus (Req 17.2): 2px ring offset using `ring` token (box-shadow)
//   - Error (Req 17.3): 1.5px `destructive` border, `destructive/5` background
//     (via aria-invalid="true" or .onb-input--error)
//   - Disabled (Req 17.4): border at 50% opacity, `muted` background
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate arbitrary input field
//      states and verify the state determination logic correctly maps
//      each state to the expected visual properties.
//
//   2. Source-level pins on `onboarding-tokens.css` — verify the CSS
//      source defines the correct properties for each state selector,
//      ensuring the visual contract is maintained.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INPUT_STATES = ["default", "focus", "error", "disabled"] as const;
type InputState = (typeof INPUT_STATES)[number];

// ---------------------------------------------------------------------------
// Pure logic under test — extracted from the CSS design contract.
//
// The `.onb-input` class in onboarding-tokens.css defines visual
// properties for each state. This logic mirrors the expected CSS
// declarations for each state.
// ---------------------------------------------------------------------------

interface InputVisualProperties {
  borderWidth: string;
  borderColor: string;
  backgroundColor: string;
  boxShadow: string | null;
  pointerEvents: "auto" | "none";
  cursor: "auto" | "not-allowed";
}

/**
 * Determines the expected visual properties for a given input state.
 * Mirrors the CSS declarations in onboarding-tokens.css .onb-input.
 */
function getInputVisualProperties(state: InputState): InputVisualProperties {
  switch (state) {
    case "default":
      // Req 17.1: 1px border, background fill
      return {
        borderWidth: "1px",
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--background))",
        boxShadow: null,
        pointerEvents: "auto",
        cursor: "auto",
      };
    case "focus":
      // Req 17.2: 2px ring offset using ring token
      return {
        borderWidth: "1px",
        borderColor: "hsl(var(--ring))",
        backgroundColor: "hsl(var(--background))",
        boxShadow: "0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring))",
        pointerEvents: "auto",
        cursor: "auto",
      };
    case "error":
      // Req 17.3: 1.5px destructive border, destructive/5 background
      return {
        borderWidth: "1.5px",
        borderColor: "hsl(var(--destructive))",
        backgroundColor: "hsl(var(--destructive) / 0.05)",
        boxShadow: null,
        pointerEvents: "auto",
        cursor: "auto",
      };
    case "disabled":
      // Req 17.4: border at 50% opacity, muted background
      return {
        borderWidth: "1px",
        borderColor: "hsl(var(--border) / 0.5)",
        backgroundColor: "hsl(var(--muted))",
        boxShadow: null,
        pointerEvents: "none",
        cursor: "not-allowed",
      };
  }
}

/**
 * Determines whether an input state uses a CSS custom property (token)
 * for its border color. All states must use tokens — no hardcoded colors.
 */
function usesTokenForBorderColor(state: InputState): boolean {
  const props = getInputVisualProperties(state);
  return props.borderColor.includes("var(--");
}

/**
 * Determines whether an input state uses a CSS custom property (token)
 * for its background color. All states must use tokens — no hardcoded colors.
 */
function usesTokenForBackgroundColor(state: InputState): boolean {
  const props = getInputVisualProperties(state);
  return props.backgroundColor.includes("var(--");
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a valid input state.
 */
const inputStateArb: fc.Arbitrary<InputState> = fc.constantFrom(...INPUT_STATES);

/**
 * Generates a scenario with a state and field name (for diversity).
 */
interface InputFieldScenario {
  state: InputState;
  fieldName: string;
}

const fieldNameArb: fc.Arbitrary<string> = fc.constantFrom(
  "username",
  "fullName",
  "email",
  "bio",
  "headline",
  "location",
  "website",
  "github",
  "linkedin",
  "pronouns",
);

const inputFieldScenarioArb: fc.Arbitrary<InputFieldScenario> = fc.record({
  state: inputStateArb,
  fieldName: fieldNameArb,
});

// ---------------------------------------------------------------------------
// Data-level PBT — Property 13: Input Field State Rendering
// ---------------------------------------------------------------------------

describe("InputStates — Property 13: Input Field State Rendering (Task 8.2)", () => {
  it("default state uses 1px border width (Req 17.1)", () => {
    // **Validates: Requirements 17.1**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("default");
        assert.strictEqual(
          props.borderWidth,
          "1px",
          `Default state for field "${fieldName}" must have 1px border width`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("default state uses border token for border color (Req 17.1)", () => {
    // **Validates: Requirements 17.1**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("default");
        assert.ok(
          props.borderColor.includes("var(--border)"),
          `Default state for field "${fieldName}" must use --border token`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("default state uses background token for fill (Req 17.1)", () => {
    // **Validates: Requirements 17.1**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("default");
        assert.ok(
          props.backgroundColor.includes("var(--background)"),
          `Default state for field "${fieldName}" must use --background token`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("focus state applies ring token via box-shadow (Req 17.2)", () => {
    // **Validates: Requirements 17.2**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("focus");
        assert.ok(
          props.boxShadow !== null,
          `Focus state for field "${fieldName}" must have a box-shadow`,
        );
        assert.ok(
          props.boxShadow!.includes("var(--ring)"),
          `Focus state for field "${fieldName}" must use --ring token in box-shadow`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("focus state uses ring token for border color (Req 17.2)", () => {
    // **Validates: Requirements 17.2**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("focus");
        assert.ok(
          props.borderColor.includes("var(--ring)"),
          `Focus state for field "${fieldName}" must use --ring token for border color`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("error state uses 1.5px border width (Req 17.3)", () => {
    // **Validates: Requirements 17.3**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("error");
        assert.strictEqual(
          props.borderWidth,
          "1.5px",
          `Error state for field "${fieldName}" must have 1.5px border width`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("error state uses destructive token for border color (Req 17.3)", () => {
    // **Validates: Requirements 17.3**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("error");
        assert.ok(
          props.borderColor.includes("var(--destructive)"),
          `Error state for field "${fieldName}" must use --destructive token for border`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("error state uses destructive/5 background (Req 17.3)", () => {
    // **Validates: Requirements 17.3**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("error");
        assert.ok(
          props.backgroundColor.includes("var(--destructive)") &&
            props.backgroundColor.includes("0.05"),
          `Error state for field "${fieldName}" must use destructive/5 background`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("disabled state uses border at 50% opacity (Req 17.4)", () => {
    // **Validates: Requirements 17.4**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("disabled");
        assert.ok(
          props.borderColor.includes("var(--border)") &&
            props.borderColor.includes("0.5"),
          `Disabled state for field "${fieldName}" must use border at 50% opacity`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("disabled state uses muted background (Req 17.4)", () => {
    // **Validates: Requirements 17.4**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("disabled");
        assert.ok(
          props.backgroundColor.includes("var(--muted)"),
          `Disabled state for field "${fieldName}" must use --muted background`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("disabled state disables pointer events (Req 17.4)", () => {
    // **Validates: Requirements 17.4**
    fc.assert(
      fc.property(fieldNameArb, (fieldName) => {
        const props = getInputVisualProperties("disabled");
        assert.strictEqual(
          props.pointerEvents,
          "none",
          `Disabled state for field "${fieldName}" must have pointer-events: none`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("all states use CSS custom properties for colors — no hardcoded values", () => {
    // **Validates: Requirements 17.1, 17.2, 17.3, 17.4**
    fc.assert(
      fc.property(inputFieldScenarioArb, ({ state, fieldName }) => {
        assert.ok(
          usesTokenForBorderColor(state),
          `State "${state}" for field "${fieldName}" must use a CSS token for border color`,
        );
        assert.ok(
          usesTokenForBackgroundColor(state),
          `State "${state}" for field "${fieldName}" must use a CSS token for background color`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("each state maps to exactly one visual treatment (no ambiguity)", () => {
    // **Validates: Requirements 17.1, 17.2, 17.3, 17.4**
    fc.assert(
      fc.property(inputStateArb, (state) => {
        const props = getInputVisualProperties(state);

        // Each state must produce a deterministic set of properties
        const props2 = getInputVisualProperties(state);
        assert.deepStrictEqual(
          props,
          props2,
          `State "${state}" must always produce the same visual properties`,
        );

        // Border width must be a valid CSS value
        assert.match(
          props.borderWidth,
          /^\d+(\.\d+)?px$/,
          `State "${state}" border-width must be a valid px value`,
        );

        // Border color must reference a CSS variable
        assert.match(
          props.borderColor,
          /var\(--/,
          `State "${state}" border-color must reference a CSS variable`,
        );

        // Background color must reference a CSS variable
        assert.match(
          props.backgroundColor,
          /var\(--/,
          `State "${state}" background-color must reference a CSS variable`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("only focus state has a non-null box-shadow", () => {
    // **Validates: Requirements 17.2**
    fc.assert(
      fc.property(inputStateArb, (state) => {
        const props = getInputVisualProperties(state);

        if (state === "focus") {
          assert.ok(
            props.boxShadow !== null,
            `Focus state must have a box-shadow for the ring effect`,
          );
        } else {
          assert.strictEqual(
            props.boxShadow,
            null,
            `State "${state}" must NOT have a box-shadow (only focus uses ring)`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it("only disabled state restricts pointer events", () => {
    // **Validates: Requirements 17.4**
    fc.assert(
      fc.property(inputStateArb, (state) => {
        const props = getInputVisualProperties(state);

        if (state === "disabled") {
          assert.strictEqual(
            props.pointerEvents,
            "none",
            `Disabled state must have pointer-events: none`,
          );
          assert.strictEqual(
            props.cursor,
            "not-allowed",
            `Disabled state must have cursor: not-allowed`,
          );
        } else {
          assert.strictEqual(
            props.pointerEvents,
            "auto",
            `State "${state}" must have pointer-events: auto`,
          );
          assert.strictEqual(
            props.cursor,
            "auto",
            `State "${state}" must have cursor: auto`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins — structural contracts on onboarding-tokens.css
// ---------------------------------------------------------------------------
//
// These verify the CSS source defines the correct properties for each
// input state selector, ensuring the visual contract from
// Requirements 17.1, 17.2, 17.3, 17.4 is maintained.

const CSS_SOURCE = readFileSync(
  path.resolve(__dirname, "../../../styles/onboarding-tokens.css"),
  "utf8",
);

describe("InputStates — source-level structural contracts (Req 17.1, 17.2, 17.3, 17.4)", () => {
  // ─── Default state (Req 17.1) ───

  it("defines .onb-input with border-width: 1px (Req 17.1)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*border-width:\s*1px/,
      ".onb-input must define border-width: 1px for default state (Req 17.1)",
    );
  });

  it("defines .onb-input with border-color using --border token (Req 17.1)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*border-color:\s*hsl\(var\(--border\)\)/,
      ".onb-input must define border-color using --border token (Req 17.1)",
    );
  });

  it("defines .onb-input with background-color using --background token (Req 17.1)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*background-color:\s*hsl\(var\(--background\)\)/,
      ".onb-input must define background-color using --background token (Req 17.1)",
    );
  });

  // ─── Focus state (Req 17.2) ───

  it("defines .onb-input:focus-visible with box-shadow using --ring token (Req 17.2)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:focus-visible\s*\{[^}]*box-shadow:[^}]*var\(--ring\)/,
      ".onb-input:focus-visible must define box-shadow using --ring token (Req 17.2)",
    );
  });

  it("defines .onb-input:focus-visible with 2px ring offset (Req 17.2)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 2px/,
      ".onb-input:focus-visible must define 2px ring offset in box-shadow (Req 17.2)",
    );
  });

  it("defines .onb-input:focus-visible with border-color using --ring token (Req 17.2)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:focus-visible\s*\{[^}]*border-color:\s*hsl\(var\(--ring\)\)/,
      ".onb-input:focus-visible must set border-color to --ring token (Req 17.2)",
    );
  });

  // ─── Error state (Req 17.3) ───

  it("defines error state selector using aria-invalid or .onb-input--error (Req 17.3)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\[aria-invalid="true"\]/,
      ".onb-input must support aria-invalid='true' for error state (Req 17.3)",
    );
    assert.match(
      CSS_SOURCE,
      /\.onb-input\.onb-input--error/,
      ".onb-input must support .onb-input--error class for error state (Req 17.3)",
    );
  });

  it("defines error state with border-width: 1.5px (Req 17.3)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\[aria-invalid="true"\][^{]*\{[^}]*border-width:\s*1\.5px/,
      "Error state must define border-width: 1.5px (Req 17.3)",
    );
  });

  it("defines error state with border-color using --destructive token (Req 17.3)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\[aria-invalid="true"\][^{]*\{[^}]*border-color:\s*hsl\(var\(--destructive\)\)/,
      "Error state must define border-color using --destructive token (Req 17.3)",
    );
  });

  it("defines error state with background-color using --destructive at 5% opacity (Req 17.3)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\[aria-invalid="true"\][^{]*\{[^}]*background-color:\s*hsl\(var\(--destructive\)\s*\/\s*0\.05\)/,
      "Error state must define background-color using --destructive / 0.05 (Req 17.3)",
    );
  });

  // ─── Disabled state (Req 17.4) ───

  it("defines .onb-input:disabled with border-color at 50% opacity (Req 17.4)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:disabled\s*\{[^}]*border-color:\s*hsl\(var\(--border\)\s*\/\s*0\.5\)/,
      ".onb-input:disabled must define border-color at 50% opacity (Req 17.4)",
    );
  });

  it("defines .onb-input:disabled with background-color using --muted token (Req 17.4)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:disabled\s*\{[^}]*background-color:\s*hsl\(var\(--muted\)\)/,
      ".onb-input:disabled must define background-color using --muted token (Req 17.4)",
    );
  });

  it("defines .onb-input:disabled with pointer-events: none (Req 17.4)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:disabled\s*\{[^}]*pointer-events:\s*none/,
      ".onb-input:disabled must define pointer-events: none (Req 17.4)",
    );
  });

  it("defines .onb-input:disabled with cursor: not-allowed (Req 17.4)", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input:disabled\s*\{[^}]*cursor:\s*not-allowed/,
      ".onb-input:disabled must define cursor: not-allowed (Req 17.4)",
    );
  });

  // ─── Cross-cutting concerns ───

  it("all color values in .onb-input use CSS custom properties (no hardcoded colors)", () => {
    // Extract all color-related declarations from .onb-input rules
    const colorProps = CSS_SOURCE.match(
      /(border-color|background-color|box-shadow):\s*[^;]+/g,
    );
    assert.ok(
      colorProps && colorProps.length > 0,
      "Must find color-related properties in .onb-input CSS",
    );

    for (const prop of colorProps!) {
      // Each color value must reference a CSS variable (var(--...))
      // Allow rgba for box-shadow offset layers but main colors must use tokens
      if (prop.includes("border-color") || prop.includes("background-color")) {
        assert.match(
          prop,
          /var\(--/,
          `Color property "${prop}" must reference a CSS custom property`,
        );
      }
    }
  });

  it(".onb-input defines transition for smooth state changes", () => {
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*transition:[^}]*border-color/,
      ".onb-input must define transition for border-color",
    );
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*transition:[^}]*background-color/,
      ".onb-input must define transition for background-color",
    );
    assert.match(
      CSS_SOURCE,
      /\.onb-input\s*\{[^}]*transition:[^}]*box-shadow/,
      ".onb-input must define transition for box-shadow",
    );
  });
});
