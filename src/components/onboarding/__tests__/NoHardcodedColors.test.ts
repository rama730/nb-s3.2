// Task 11.3 — Property 9: No Hardcoded Colors
//
// **Validates: Requirements 15.1, 18.1**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any color-related style in onboarding components, the value must
// reference a CSS custom property (semantic token) rather than a
// hardcoded color value.
//
// Specifically:
//   1. No hardcoded hex colors (#fff, #000, #3b82f6, etc.) in className strings
//   2. No hardcoded Tailwind color-number classes (text-red-500, bg-blue-100, etc.)
//   3. All color references use semantic tokens (primary, destructive, muted,
//      foreground, background, border, ring, card, chart-2, chart-5)
//   4. The onboarding-tokens.css file uses CSS custom properties for all color
//      values (except rgba for shadows which is acceptable)
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant via source-level analysis:
//
//   1. Data-level PBT — generate arbitrary component file + line
//      combinations and verify no hardcoded color patterns exist.
//
//   2. Source-level pins on onboarding-tokens.css — verify all
//      color-related CSS declarations use CSS custom properties.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONBOARDING_DIR = path.resolve(__dirname, "..");
const TOKENS_FILE = path.resolve(__dirname, "../../../styles/onboarding-tokens.css");

/**
 * Semantic color tokens allowed in Tailwind classes.
 * These reference CSS custom properties and adapt to dark mode.
 */
const SEMANTIC_TOKENS = [
  "primary",
  "destructive",
  "muted",
  "foreground",
  "background",
  "border",
  "ring",
  "card",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "accent",
  "popover",
  "secondary",
  "input",
  "sidebar",
  "muted-foreground",
  "primary-foreground",
  "destructive-foreground",
  "accent-foreground",
  "popover-foreground",
  "card-foreground",
  "secondary-foreground",
] as const;

/**
 * Tailwind color names that are hardcoded (not semantic tokens).
 * These map to fixed color values and don't adapt to themes/dark mode.
 */
const HARDCODED_TAILWIND_COLORS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
] as const;

// ---------------------------------------------------------------------------
// Source file loading
// ---------------------------------------------------------------------------

/**
 * Loads all onboarding component source files (.tsx, .ts) excluding __tests__.
 */
function loadOnboardingSourceFiles(): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];

  // Top-level component files
  const topLevelFiles = readdirSync(ONBOARDING_DIR).filter(
    (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")
  );
  for (const file of topLevelFiles) {
    files.push({
      name: file,
      content: readFileSync(path.join(ONBOARDING_DIR, file), "utf8"),
    });
  }

  // Steps subdirectory
  const stepsDir = path.join(ONBOARDING_DIR, "steps");
  try {
    const stepFiles = readdirSync(stepsDir).filter(
      (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")
    );
    for (const file of stepFiles) {
      files.push({
        name: `steps/${file}`,
        content: readFileSync(path.join(stepsDir, file), "utf8"),
      });
    }
  } catch {
    // steps directory may not exist
  }

  return files;
}

const SOURCE_FILES = loadOnboardingSourceFiles();
const TOKENS_CSS = readFileSync(TOKENS_FILE, "utf8");

// ---------------------------------------------------------------------------
// Detection utilities
// ---------------------------------------------------------------------------

/**
 * Regex to detect hardcoded hex color values in className strings.
 * Matches patterns like: #fff, #000, #3b82f6, #FF0000, etc.
 * Excludes hex values that are part of CSS custom property references.
 */
const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;

/**
 * Regex to detect hardcoded Tailwind color-number utility classes.
 * Matches patterns like: text-red-500, bg-blue-100, border-green-300, etc.
 * Does NOT match semantic tokens like text-primary, bg-muted, border-border.
 */
function buildHardcodedTailwindColorRegex(): RegExp {
  const colorNames = HARDCODED_TAILWIND_COLORS.join("|");
  // Matches: (prefix)-(color)-(shade) where prefix is a color-related utility
  return new RegExp(
    `\\b(?:text|bg|border|ring|outline|shadow|from|to|via|fill|stroke|decoration|accent|caret|divide|placeholder)-(?:${colorNames})-\\d{2,3}\\b`,
    "g"
  );
}

const HARDCODED_TAILWIND_REGEX = buildHardcodedTailwindColorRegex();

/**
 * Extracts className string content from a source file.
 * Handles: className="...", className={cn(...)}, className={`...`}
 */
function extractClassNameStrings(source: string): string[] {
  const results: string[] = [];

  // Match string literals in className, cn(), and template literals
  // Simple approach: extract all string literals that look like Tailwind classes
  const stringLiteralRegex = /['"`]([^'"`]*(?:bg-|text-|border-|ring-|shadow-|from-|to-|via-|fill-|stroke-|outline-|decoration-|accent-|caret-|divide-|placeholder-)[^'"`]*)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = stringLiteralRegex.exec(source)) !== null) {
    results.push(match[1]);
  }

  return results;
}

/**
 * Checks if a hex color appears in a className context (not in a comment or
 * CSS custom property definition).
 */
function findHexColorsInClassNames(source: string): string[] {
  const classStrings = extractClassNameStrings(source);
  const found: string[] = [];

  for (const str of classStrings) {
    const matches = str.match(HEX_COLOR_REGEX);
    if (matches) {
      found.push(...matches);
    }
  }

  return found;
}

/**
 * Finds hardcoded Tailwind color-number classes in source.
 */
function findHardcodedTailwindColors(source: string): string[] {
  const classStrings = extractClassNameStrings(source);
  const found: string[] = [];

  for (const str of classStrings) {
    HARDCODED_TAILWIND_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HARDCODED_TAILWIND_REGEX.exec(str)) !== null) {
      found.push(match[0]);
    }
  }

  return found;
}

/**
 * Checks if a Tailwind color class uses a semantic token.
 * Returns true if the class references a semantic token (e.g., text-primary, bg-muted).
 */
function isSemanticColorClass(className: string): boolean {
  // Extract the color part after the prefix (e.g., "primary" from "text-primary")
  const prefixes = [
    "text-",
    "bg-",
    "border-",
    "ring-",
    "ring-offset-",
    "outline-",
    "shadow-",
    "from-",
    "to-",
    "via-",
    "fill-",
    "stroke-",
    "decoration-",
    "accent-",
    "caret-",
    "divide-",
    "placeholder-",
  ];

  // Sort prefixes by length descending so longer prefixes match first
  // (e.g., "ring-offset-" before "ring-")
  const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    if (className.startsWith(prefix)) {
      const colorPart = className.slice(prefix.length);
      // Remove opacity modifier (e.g., "primary/10" -> "primary")
      const baseColor = colorPart.split("/")[0];
      // Check if it's a semantic token
      if (SEMANTIC_TOKENS.some((token) => baseColor === token)) {
        return true;
      }
      // Also allow "white" and "black" and "transparent" and "current" as they are
      // standard Tailwind utilities (white is used for text on primary buttons)
      if (["white", "black", "transparent", "current", "inherit"].includes(baseColor)) {
        return true;
      }
      // Found a matching prefix but color is not semantic — stop checking
      return false;
    }
  }

  return false;
}

/**
 * Non-color utility classes that start with color-related prefixes but
 * don't actually set a color value. These are layout/behavior utilities.
 */
const NON_COLOR_UTILITIES = new Set([
  // outline utilities
  "outline-none",
  "outline-dashed",
  "outline-dotted",
  "outline-double",
  "outline-hidden",
  // ring utilities (non-color)
  "ring-offset-0",
  "ring-offset-1",
  "ring-offset-2",
  "ring-offset-4",
  "ring-offset-8",
  "ring-0",
  "ring-1",
  "ring-2",
  "ring-4",
  "ring-8",
  "ring-inset",
  // border utilities (non-color)
  "border-0",
  "border-1",
  "border-2",
  "border-4",
  "border-8",
  "border-t",
  "border-b",
  "border-l",
  "border-r",
  "border-x",
  "border-y",
  "border-collapse",
  "border-separate",
  "border-solid",
  "border-dashed",
  "border-dotted",
  "border-double",
  "border-hidden",
  "border-none",
  "border-spacing-0",
  // shadow utilities (non-color)
  "shadow-sm",
  "shadow-md",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
  "shadow-inner",
  "shadow-none",
  // text utilities (non-color)
  "text-left",
  "text-center",
  "text-right",
  "text-justify",
  "text-start",
  "text-end",
  "text-wrap",
  "text-nowrap",
  "text-balance",
  "text-pretty",
  "text-ellipsis",
  "text-clip",
  // divide utilities (non-color)
  "divide-x",
  "divide-y",
  "divide-solid",
  "divide-dashed",
  "divide-dotted",
  "divide-double",
  "divide-none",
]);

/**
 * Checks if a class is a non-color utility that happens to start with a
 * color-related prefix.
 */
function isNonColorUtility(className: string): boolean {
  // Direct match
  if (NON_COLOR_UTILITIES.has(className)) return true;

  // Patterns that are not color-related:
  // - border-[1.5px], border-[var(...)], ring-[3px] — arbitrary values for width/size
  if (/^(?:border|ring|outline)-\[/.test(className)) return true;

  // - text-[13px], text-[14px] — arbitrary font sizes
  if (/^text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/.test(className)) return true;

  // - shadow-[...] — arbitrary shadow values
  if (/^shadow-\[/.test(className)) return true;

  // - ring-offset-[...] — arbitrary ring offset
  if (/^ring-offset-\[/.test(className)) return true;

  // - from-[...], to-[...], via-[...] — arbitrary gradient stops
  if (/^(?:from|to|via)-\[/.test(className)) return true;

  // - border-t-0, border-b-2, etc. — border width with direction
  if (/^border-[trblxy]-\d+$/.test(className)) return true;

  // - divide-x-0, divide-y-2, etc. — divide width
  if (/^divide-[xy]-\d+$/.test(className)) return true;

  // - text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, etc. — font sizes
  if (/^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/.test(className)) return true;

  // - Transition property lists that contain color words (e.g., transition-[background-color,border-color])
  if (/^transition-\[/.test(className)) return true;

  // Classes extracted from transition-[background-color,border-color] split by comma
  if (className === "border-color" || className === "background-color" || className === "box-shadow") return true;

  // - accent-gradient is part of `app-accent-gradient` custom class, not a Tailwind color utility
  if (className === "accent-gradient") return true;

  // - transition-colors is a transition utility, not a color
  if (className === "transition-colors") return true;

  return false;
}

/**
 * Extracts all color-related Tailwind classes from source.
 * Filters out non-color utilities that happen to share prefixes.
 */
function extractColorClasses(source: string): string[] {
  const classStrings = extractClassNameStrings(source);
  const colorClasses: string[] = [];

  // Match color-related utility prefixes followed by a color name
  const colorClassRegex =
    /\b(?:text|bg|border|ring-offset|ring|outline|shadow|from|to|via|fill|stroke|decoration|accent|caret|divide|placeholder)-[a-z][\w/.-]*\b/g;

  for (const str of classStrings) {
    colorClassRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = colorClassRegex.exec(str)) !== null) {
      const cls = match[0];
      // Skip non-color utilities
      if (isNonColorUtility(cls)) continue;
      colorClasses.push(cls);
    }
  }

  return colorClasses;
}

/**
 * Checks CSS source for hardcoded color values in color-related properties.
 * Allows rgba() only in shadow declarations.
 */
function findHardcodedCSSColors(cssSource: string): string[] {
  const violations: string[] = [];

  // Extract all property declarations
  const declarationRegex = /([\w-]+)\s*:\s*([^;]+)/g;
  let match: RegExpExecArray | null;

  while ((match = declarationRegex.exec(cssSource)) !== null) {
    const property = match[1];
    const value = match[2].trim();

    // Only check color-related properties (not shadows)
    const isColorProperty = [
      "color",
      "background-color",
      "border-color",
      "outline-color",
      "fill",
      "stroke",
    ].includes(property);

    if (isColorProperty) {
      // Check for hex colors
      if (HEX_COLOR_REGEX.test(value)) {
        HEX_COLOR_REGEX.lastIndex = 0;
        violations.push(`${property}: ${value} (contains hex color)`);
      }
      // Check for rgb/rgba without var()
      if (/rgba?\s*\(/.test(value) && !value.includes("var(")) {
        violations.push(`${property}: ${value} (contains hardcoded rgb/rgba)`);
      }
      // Check for named colors (excluding 'none', 'inherit', 'transparent', 'currentColor')
      const namedColorRegex = /\b(?:red|blue|green|yellow|orange|purple|pink|white|black|gray|grey)\b/i;
      if (namedColorRegex.test(value) && !["none", "inherit", "transparent", "currentColor"].some((k) => value.includes(k))) {
        violations.push(`${property}: ${value} (contains named color)`);
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a random source file from the loaded onboarding components.
 */
const sourceFileArb: fc.Arbitrary<{ name: string; content: string }> = fc.constantFrom(
  ...SOURCE_FILES
);

/**
 * Generates a random index into a source file's lines.
 */
const fileWithLineArb: fc.Arbitrary<{ fileName: string; lineIndex: number; line: string }> =
  sourceFileArb.chain((file) => {
    const lines = file.content.split("\n");
    if (lines.length === 0) {
      return fc.constant({ fileName: file.name, lineIndex: 0, line: "" });
    }
    return fc.integer({ min: 0, max: lines.length - 1 }).map((idx) => ({
      fileName: file.name,
      lineIndex: idx,
      line: lines[idx],
    }));
  });

// ---------------------------------------------------------------------------
// Data-level PBT — Property 9: No Hardcoded Colors
// ---------------------------------------------------------------------------

describe("NoHardcodedColors — Property 9: No Hardcoded Colors (Task 11.3)", () => {
  // ─── PBT: No hex colors in className strings ───

  it("no hardcoded hex colors (#xxx, #xxxxxx) in any onboarding component className", () => {
    // **Validates: Requirements 15.1, 18.1**
    fc.assert(
      fc.property(sourceFileArb, (file) => {
        const hexColors = findHexColorsInClassNames(file.content);
        assert.deepStrictEqual(
          hexColors,
          [],
          `File "${file.name}" contains hardcoded hex colors in className strings: ${hexColors.join(", ")}`
        );
      }),
      { numRuns: 100 },
    );
  });

  // ─── PBT: No hardcoded Tailwind color-number classes ───

  it("no hardcoded Tailwind color-number classes (e.g., text-red-500, bg-blue-100) in any onboarding component", () => {
    // **Validates: Requirements 15.1, 18.1**
    fc.assert(
      fc.property(sourceFileArb, (file) => {
        const hardcodedColors = findHardcodedTailwindColors(file.content);
        assert.deepStrictEqual(
          hardcodedColors,
          [],
          `File "${file.name}" contains hardcoded Tailwind color classes: ${hardcodedColors.join(", ")}`
        );
      }),
      { numRuns: 100 },
    );
  });

  // ─── PBT: All color classes use semantic tokens ───

  it("all color-related Tailwind classes reference semantic tokens (primary, destructive, muted, foreground, etc.)", () => {
    // **Validates: Requirements 15.1, 18.1**
    fc.assert(
      fc.property(sourceFileArb, (file) => {
        const colorClasses = extractColorClasses(file.content);
        const nonSemantic = colorClasses.filter((cls) => !isSemanticColorClass(cls));
        assert.deepStrictEqual(
          nonSemantic,
          [],
          `File "${file.name}" contains non-semantic color classes: ${nonSemantic.join(", ")}`
        );
      }),
      { numRuns: 100 },
    );
  });

  // ─── PBT: Per-line verification across random lines ───

  it("no individual line in any onboarding component contains a hardcoded hex color in a class context", () => {
    // **Validates: Requirements 15.1, 18.1**
    fc.assert(
      fc.property(fileWithLineArb, ({ fileName, lineIndex, line }) => {
        // Only check lines that contain className-like patterns
        if (!line.includes("className") && !line.includes("cn(") && !line.includes("'") && !line.includes('"')) {
          return; // skip non-relevant lines
        }

        // Check for hex colors in the line (but not in comments)
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
          return; // skip comments
        }

        // Look for hex colors that appear to be in string contexts
        const stringParts = line.match(/['"`][^'"`]*['"`]/g) || [];
        for (const part of stringParts) {
          HEX_COLOR_REGEX.lastIndex = 0;
          const hexMatches = part.match(HEX_COLOR_REGEX);
          if (hexMatches) {
            assert.fail(
              `File "${fileName}" line ${lineIndex + 1} contains hardcoded hex color(s) in string: ${hexMatches.join(", ")}`
            );
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins — onboarding-tokens.css color compliance
// ---------------------------------------------------------------------------

describe("NoHardcodedColors — onboarding-tokens.css uses CSS custom properties (Req 15.1, 18.1)", () => {
  it("all color-related CSS properties in onboarding-tokens.css use CSS custom properties (var(--...))", () => {
    // **Validates: Requirements 15.1, 18.1**
    const violations = findHardcodedCSSColors(TOKENS_CSS);
    assert.deepStrictEqual(
      violations,
      [],
      `onboarding-tokens.css contains hardcoded color values:\n${violations.join("\n")}`
    );
  });

  it("shadow declarations may use rgba() but color properties must not", () => {
    // **Validates: Requirements 15.1, 18.1**
    // Extract shadow values — these are allowed to use rgba
    const shadowDeclarations = TOKENS_CSS.match(/--onb-shadow[\w-]*:\s*[^;]+/g) || [];
    assert.ok(
      shadowDeclarations.length > 0,
      "onboarding-tokens.css must define shadow tokens",
    );

    // Verify shadows use rgba (acceptable)
    for (const shadow of shadowDeclarations) {
      assert.match(
        shadow,
        /rgba\(/,
        `Shadow declaration "${shadow}" should use rgba() for shadow values`,
      );
    }
  });

  it("border-color declarations use hsl(var(--...)) pattern", () => {
    // **Validates: Requirements 15.1, 18.1**
    const borderColorDecls = TOKENS_CSS.match(/border-color:\s*[^;]+/g) || [];
    for (const decl of borderColorDecls) {
      assert.match(
        decl,
        /var\(--/,
        `border-color declaration must use CSS custom property: "${decl}"`,
      );
    }
  });

  it("background-color declarations use hsl(var(--...)) pattern", () => {
    // **Validates: Requirements 15.1, 18.1**
    const bgColorDecls = TOKENS_CSS.match(/background-color:\s*[^;]+/g) || [];
    for (const decl of bgColorDecls) {
      assert.match(
        decl,
        /var\(--/,
        `background-color declaration must use CSS custom property: "${decl}"`,
      );
    }
  });

  it("no hex color values appear in non-shadow CSS declarations", () => {
    // **Validates: Requirements 15.1, 18.1**
    // Split CSS into lines and check non-shadow property lines
    const lines = TOKENS_CSS.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments, empty lines, and shadow declarations
      if (
        line.startsWith("/*") ||
        line.startsWith("*") ||
        line.startsWith("//") ||
        line === "" ||
        line.includes("--onb-shadow")
      ) {
        continue;
      }

      // Check for color-related properties with hex values
      if (
        (line.includes("border-color") ||
          line.includes("background-color") ||
          line.includes("color:")) &&
        !line.includes("var(--")
      ) {
        // Allow lines that are just property names in comments
        if (!line.startsWith("/*") && !line.startsWith("*")) {
          HEX_COLOR_REGEX.lastIndex = 0;
          const hexMatch = line.match(HEX_COLOR_REGEX);
          if (hexMatch) {
            assert.fail(
              `Line ${i + 1} in onboarding-tokens.css has hardcoded hex color: "${line}"`
            );
          }
        }
      }
    }
  });

  // ─── PBT: Random sampling of CSS lines ───

  it("randomly sampled CSS lines with color properties always reference CSS variables", () => {
    // **Validates: Requirements 15.1, 18.1**
    const cssLines = TOKENS_CSS.split("\n")
      .map((line, idx) => ({ line: line.trim(), lineNum: idx + 1 }))
      .filter(
        ({ line }) =>
          line.length > 0 &&
          !line.startsWith("/*") &&
          !line.startsWith("*") &&
          !line.startsWith("//")
      );

    const cssLineArb = fc.constantFrom(...cssLines);

    fc.assert(
      fc.property(cssLineArb, ({ line, lineNum }) => {
        // Only check lines that set color-related properties
        const isColorLine =
          (line.includes("border-color:") ||
            line.includes("background-color:") ||
            (line.match(/^\s*color:/) !== null)) &&
          !line.includes("--onb-shadow");

        if (!isColorLine) return; // skip non-color lines

        // Must reference a CSS variable
        assert.ok(
          line.includes("var(--"),
          `CSS line ${lineNum} sets a color property without CSS variable: "${line}"`,
        );
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-file verification — all onboarding components collectively
// ---------------------------------------------------------------------------

describe("NoHardcodedColors — cross-file collective verification (Req 15.1, 18.1)", () => {
  it("no onboarding component file contains hardcoded hex colors in className strings", () => {
    // **Validates: Requirements 15.1, 18.1**
    for (const file of SOURCE_FILES) {
      const hexColors = findHexColorsInClassNames(file.content);
      assert.deepStrictEqual(
        hexColors,
        [],
        `File "${file.name}" contains hardcoded hex colors: ${hexColors.join(", ")}`
      );
    }
  });

  it("no onboarding component file contains hardcoded Tailwind color-number classes", () => {
    // **Validates: Requirements 15.1, 18.1**
    for (const file of SOURCE_FILES) {
      const hardcoded = findHardcodedTailwindColors(file.content);
      assert.deepStrictEqual(
        hardcoded,
        [],
        `File "${file.name}" contains hardcoded Tailwind colors: ${hardcoded.join(", ")}`
      );
    }
  });

  it("all color-related classes across all onboarding files use semantic tokens", () => {
    // **Validates: Requirements 15.1, 18.1**
    for (const file of SOURCE_FILES) {
      const colorClasses = extractColorClasses(file.content);
      const nonSemantic = colorClasses.filter((cls) => !isSemanticColorClass(cls));
      assert.deepStrictEqual(
        nonSemantic,
        [],
        `File "${file.name}" has non-semantic color classes: ${nonSemantic.join(", ")}`
      );
    }
  });
});
