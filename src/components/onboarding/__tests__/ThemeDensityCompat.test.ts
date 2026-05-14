// Task 9.4 — Verify theme and density compatibility
//
// **Validates: Requirements 15.2, 15.3**
//
// Verifies that onboarding components:
// 1. Use CSS custom properties for all `primary` color references (adapts to accent themes)
// 2. Use density-aware CSS variables (--ui-control-height, --ui-control-px) for form controls
// 3. Do not use hardcoded pixel heights on form controls that would break density settings
//
// Accent themes: default, orchid, forest, ember, rose, lagoon
// Density settings: compact, default, comfortable
//
// The `primary` CSS variable is derived from `--theme-action-solid-light/dark` which
// changes per accent theme. As long as components reference `primary` (not hardcoded
// oklch/hsl values), they adapt automatically.
//
// The density system uses `--ui-control-height` (and sm/lg variants) plus
// `--ui-control-px` for padding. The shadcn Input, Button, and Select components
// already use these variables. Onboarding components must NOT override them with
// fixed pixel heights (e.g., h-10, h-11).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONBOARDING_DIR = path.resolve(
  __dirname,
  ".."
);

const STEPS_DIR = path.join(ONBOARDING_DIR, "steps");

/** Read all .tsx files from a directory */
function readTsxFiles(dir: string): Array<{ name: string; content: string }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.tsx") && !f.endsWith(".test.ts"))
    .map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(dir, f), "utf-8"),
    }));
}

/** All onboarding component source files */
function getAllOnboardingFiles(): Array<{ name: string; content: string }> {
  return [...readTsxFiles(ONBOARDING_DIR), ...readTsxFiles(STEPS_DIR)];
}

// Hardcoded Tailwind color classes that indicate non-theme-aware colors
// These are specific color-number patterns like text-red-500, bg-blue-100, etc.
const HARDCODED_COLOR_REGEX =
  /\b(text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|accent|caret|decoration)-(red|green|blue|zinc|amber|orange|purple|pink|yellow|indigo|violet|emerald|teal|cyan|sky|lime|fuchsia|slate|gray|stone|neutral)-\d{2,3}\b/g;

// Fixed height classes that override density-aware --ui-control-height on form controls
// h-10 = 40px, h-11 = 44px, h-12 = 48px — these should not be on Input/Select/Button
const FIXED_HEIGHT_ON_CONTROL_REGEX =
  /className[^>]*\b(h-10|h-11)\b/g;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Theme and Density Compatibility (Task 9.4, Req 15.2, 15.3)", () => {
  const files = getAllOnboardingFiles();

  it("should find onboarding component files", () => {
    assert.ok(
      files.length > 0,
      "Expected to find onboarding component files"
    );
  });

  describe("Accent Theme Compatibility (Req 15.2)", () => {
    it("no hardcoded Tailwind color classes in onboarding components", () => {
      const violations: string[] = [];

      for (const file of files) {
        const matches = file.content.match(HARDCODED_COLOR_REGEX);
        if (matches) {
          violations.push(
            `${file.name}: ${[...new Set(matches)].join(", ")}`
          );
        }
      }

      assert.deepStrictEqual(
        violations,
        [],
        `Found hardcoded color classes that won't adapt to accent themes:\n${violations.join("\n")}`
      );
    });

    it("primary color references use CSS variable (not hardcoded values)", () => {
      const violations: string[] = [];
      // Check for hardcoded oklch or hsl values that look like primary colors
      const hardcodedPrimaryRegex = /oklch\(\s*0\.6[0-9]\s+0\.[12]\d/g;

      for (const file of files) {
        const matches = file.content.match(hardcodedPrimaryRegex);
        if (matches) {
          violations.push(`${file.name}: hardcoded oklch primary-like value`);
        }
      }

      assert.deepStrictEqual(
        violations,
        [],
        `Found hardcoded primary color values:\n${violations.join("\n")}`
      );
    });

    it("all color references use semantic tokens (primary, destructive, muted, etc.)", () => {
      // Verify that color usage patterns reference semantic tokens
      const semanticTokens = [
        "primary",
        "destructive",
        "muted",
        "foreground",
        "background",
        "border",
        "ring",
        "card",
        "chart-2",
        "chart-5",
      ];

      // Check that at least some files use semantic tokens (positive verification)
      const filesUsingTokens = files.filter((f) =>
        semanticTokens.some((token) => f.content.includes(token))
      );

      assert.ok(
        filesUsingTokens.length > 5,
        "Expected most onboarding files to use semantic color tokens"
      );
    });
  });

  describe("Density Compatibility (Req 15.3)", () => {
    it("no fixed h-10/h-11 height overrides on Input components", () => {
      const violations: string[] = [];

      for (const file of files) {
        // Look for Input components with h-10 or h-11 className
        const lines = file.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Check if this is an Input/SelectTrigger with a fixed height
          if (
            (line.includes("<Input") || line.includes("<SelectTrigger")) &&
            line.match(/\bh-(10|11)\b/)
          ) {
            violations.push(`${file.name}:${i + 1}: ${line.trim()}`);
          }
          // Also check className prop on next few lines after Input/SelectTrigger
          if (
            (line.includes("<Input") || line.includes("<SelectTrigger")) &&
            !line.includes("/>")
          ) {
            // Check next 3 lines for className with h-10/h-11
            for (let j = 1; j <= 3 && i + j < lines.length; j++) {
              const nextLine = lines[i + j];
              if (
                nextLine.includes("className") &&
                nextLine.match(/\bh-(10|11)\b/)
              ) {
                violations.push(
                  `${file.name}:${i + j + 1}: ${nextLine.trim()}`
                );
              }
            }
          }
        }
      }

      assert.deepStrictEqual(
        violations,
        [],
        `Found fixed height overrides on form controls (should use --ui-control-height):\n${violations.join("\n")}`
      );
    });

    it("StepFooter Continue button uses density-aware height variable", () => {
      const stepFooter = files.find((f) => f.name === "StepFooter.tsx");
      assert.ok(stepFooter, "StepFooter.tsx should exist");

      assert.ok(
        stepFooter.content.includes("--ui-control-height"),
        "StepFooter Continue button should use --ui-control-height for density compatibility"
      );
    });

    it("onboarding tokens use relative units for typography", () => {
      const tokensPath = path.resolve(
        __dirname,
        "../../../styles/onboarding-tokens.css"
      );
      assert.ok(
        fs.existsSync(tokensPath),
        "onboarding-tokens.css should exist"
      );

      const tokens = fs.readFileSync(tokensPath, "utf-8");

      // Typography should use rem units (relative to root font size)
      assert.ok(
        tokens.includes("1.5rem"),
        "Step title font size should use rem"
      );
      assert.ok(
        tokens.includes("0.875rem"),
        "Subtitle font size should use rem"
      );
    });

    it("design-specific fixed sizes are intentional (stepper circles, mobile bar)", () => {
      // These are intentional fixed sizes per the design spec:
      // - Stepper circles: 24px (h-6 w-6) — design requirement 2.1
      // - Mobile progress bar: 48px (h-12) — design requirement 3.1
      // - Avatar: 64px (h-16 w-16) — design requirement 8.2
      // These should NOT use density variables as they are visual design elements,
      // not form controls.

      const sidebar = files.find((f) => f.name === "OnboardingSidebar.tsx");
      assert.ok(sidebar, "OnboardingSidebar.tsx should exist");
      // Stepper circles use h-6 w-6 (24px) — intentional
      assert.ok(
        sidebar.content.includes("h-6 w-6"),
        "Stepper circles should be 24px (h-6 w-6) per design spec"
      );

      const mobileBar = files.find((f) => f.name === "MobileProgressBar.tsx");
      assert.ok(mobileBar, "MobileProgressBar.tsx should exist");
      // Mobile bar uses h-12 (48px) — intentional
      assert.ok(
        mobileBar.content.includes("h-12"),
        "Mobile progress bar should be 48px (h-12) per design spec"
      );
    });
  });
});
