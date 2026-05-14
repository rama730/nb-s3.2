// Task 11.2 — Property 15: No Decorative Icons in Step Headers
//
// **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For any step (1–4), the StepHeader component SHALL NOT render
// decorative icon circles, emoji characters, or Sparkles/Shield/User
// icons. It renders only a title and subtitle as plain text elements.
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library. Following the
// established pattern, we prove the invariant via source-level pins on
// `StepHeader.tsx` — verifying the component:
//
//   1. Does NOT import any icon components (Sparkles, Shield, User, etc.)
//   2. Does NOT contain emoji characters
//   3. Only renders title and subtitle text elements
//   4. Does NOT render any SVG elements or icon-related markup
//
// Additionally, a data-level PBT verifies that for any arbitrary step
// (1–4), the step UI config titles/subtitles contain no emoji.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_HEADER_SOURCE = readFileSync(
  path.resolve(__dirname, "../StepHeader.tsx"),
  "utf8",
);

/** Common icon component names that must NOT appear in StepHeader */
const FORBIDDEN_ICON_IMPORTS = [
  "Sparkles",
  "Shield",
  "User",
  "Clock3",
  "Users",
  "Star",
  "Heart",
  "Globe",
  "MapPin",
  "CheckCircle",
  "AlertCircle",
  "Info",
  "Zap",
  "Award",
];

/**
 * Regex matching common emoji Unicode ranges:
 * - Emoticons (U+1F600–U+1F64F)
 * - Misc Symbols and Pictographs (U+1F300–U+1F5FF)
 * - Transport and Map Symbols (U+1F680–U+1F6FF)
 * - Supplemental Symbols (U+1F900–U+1F9FF)
 * - Dingbats (U+2700–U+27BF)
 * - Misc Symbols (U+2600–U+26FF)
 * - Variation Selectors (U+FE00–U+FE0F)
 */
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{FE00}-\u{FE0F}\u{200D}\u{2B50}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3030}\u{303D}\u{3297}\u{3299}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F1E0}-\u{1F1FF}\u{1F201}-\u{1F202}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F250}-\u{1F251}]/u;

/** SVG-related JSX tags and attributes */
const SVG_PATTERNS = [
  /<svg[\s>]/i,
  /<path[\s>]/i,
  /<circle[\s>]/i,
  /<rect[\s>]/i,
  /<polygon[\s>]/i,
  /<line[\s>]/i,
  /<polyline[\s>]/i,
  /<ellipse[\s>]/i,
];

// ---------------------------------------------------------------------------
// Source-level pins — Property 15: No Decorative Icons in Step Headers
// ---------------------------------------------------------------------------

describe("StepHeader — Property 15: No Decorative Icons in Step Headers (Task 11.2)", () => {
  describe("source-level: no icon imports", () => {
    it("does NOT import any icon components (Sparkles, Shield, User, etc.)", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // StepHeader must not import any icon library components.
      for (const iconName of FORBIDDEN_ICON_IMPORTS) {
        // Check for named imports like: import { Sparkles } from '...'
        const importPattern = new RegExp(
          `import\\s+.*\\b${iconName}\\b.*from`,
          "i",
        );
        assert.doesNotMatch(
          STEP_HEADER_SOURCE,
          importPattern,
          `StepHeader must NOT import the "${iconName}" icon component (Req 4.4, 8.6, 11.4, 12.4)`,
        );
      }
    });

    it("does NOT import from lucide-react or any icon library", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // No icon library should be referenced at all.
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        /from\s+['"]lucide-react['"]/,
        "StepHeader must NOT import from lucide-react (Req 4.4, 8.6, 11.4, 12.4)",
      );
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        /from\s+['"]@heroicons/,
        "StepHeader must NOT import from @heroicons (Req 4.4, 8.6, 11.4, 12.4)",
      );
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        /from\s+['"]react-icons/,
        "StepHeader must NOT import from react-icons (Req 4.4, 8.6, 11.4, 12.4)",
      );
    });
  });

  describe("source-level: no emoji characters", () => {
    it("does NOT contain any emoji characters in the source", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // The component source must be free of emoji characters.
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        EMOJI_REGEX,
        "StepHeader must NOT contain emoji characters (Req 4.4, 8.6)",
      );
    });
  });

  describe("source-level: only renders title and subtitle text elements", () => {
    it("renders an h1 element for the title", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      assert.match(
        STEP_HEADER_SOURCE,
        /<h1[\s>]/,
        "StepHeader must render an <h1> element for the title",
      );
    });

    it("renders a p element for the subtitle", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      assert.match(
        STEP_HEADER_SOURCE,
        /<p[\s>]/,
        "StepHeader must render a <p> element for the subtitle",
      );
    });

    it("renders only title and subtitle as content (no extra decorative elements)", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // The component should only render {title} and {subtitle} as dynamic content.
      // Count JSX expression slots — should be exactly 2 (title and subtitle).
      const jsxExpressions = STEP_HEADER_SOURCE.match(/\{[a-zA-Z]+\}/g) || [];
      const contentExpressions = jsxExpressions.filter(
        (expr) => expr === "{title}" || expr === "{subtitle}",
      );
      assert.strictEqual(
        contentExpressions.length,
        2,
        "StepHeader must render exactly {title} and {subtitle} as content expressions",
      );
    });
  });

  describe("source-level: no SVG elements or icon-related markup", () => {
    it("does NOT render any SVG elements", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // No inline SVG markup should exist in the component.
      for (const pattern of SVG_PATTERNS) {
        assert.doesNotMatch(
          STEP_HEADER_SOURCE,
          pattern,
          `StepHeader must NOT contain SVG element matching ${pattern} (Req 4.4, 8.6, 11.4, 12.4)`,
        );
      }
    });

    it("does NOT contain icon-related CSS classes", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // No icon-related utility classes should be present.
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        /className=.*icon/i,
        "StepHeader must NOT use icon-related CSS classes (Req 4.4, 8.6, 11.4, 12.4)",
      );
    });

    it("does NOT render decorative circle elements", () => {
      // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
      // No rounded-full circles that would serve as icon backgrounds.
      assert.doesNotMatch(
        STEP_HEADER_SOURCE,
        /rounded-full.*bg-/,
        "StepHeader must NOT render decorative circles (rounded-full with bg-) (Req 4.4)",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Data-level PBT — verify step UI config titles/subtitles have no emoji
// ---------------------------------------------------------------------------

describe("StepHeader — data-level PBT: step config has no emoji (Task 11.2)", () => {
  // Step UI config for all 4 steps (matching STEP_UI_CONFIG from the codebase)
  const STEP_CONFIGS = [
    { step: 1, title: "Let's set up your profile", subtitle: "Choose a username and confirm your name" },
    { step: 2, title: "Tell us about yourself", subtitle: "This helps us personalize your experience" },
    { step: 3, title: "What are you good at?", subtitle: "Pick skills and topics that describe you" },
    { step: 4, title: "Privacy & visibility", subtitle: "Control who sees your profile" },
  ];

  it("for any step (1–4), the title contains no emoji characters", () => {
    // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        (index) => {
          const config = STEP_CONFIGS[index];
          assert.doesNotMatch(
            config.title,
            EMOJI_REGEX,
            `Step ${config.step} title "${config.title}" must NOT contain emoji (Req 4.4, 8.6)`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any step (1–4), the subtitle contains no emoji characters", () => {
    // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        (index) => {
          const config = STEP_CONFIGS[index];
          assert.doesNotMatch(
            config.subtitle,
            EMOJI_REGEX,
            `Step ${config.step} subtitle "${config.subtitle}" must NOT contain emoji (Req 4.4, 8.6)`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any step (1–4), the title does not reference icon component names", () => {
    // **Validates: Requirements 4.4, 8.6, 11.4, 12.4**
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        (index) => {
          const config = STEP_CONFIGS[index];
          for (const iconName of FORBIDDEN_ICON_IMPORTS) {
            assert.ok(
              !config.title.includes(iconName),
              `Step ${config.step} title must NOT reference icon "${iconName}" (Req 11.4, 12.4)`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
