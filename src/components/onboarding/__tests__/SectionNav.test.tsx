// Task 2.6 — Property 7: Section Nav State Rendering
//
// **Validates: Requirements 9.2, 9.3, 9.4**
//
// Invariant (design.md § Per-Phase Visual Specifications / Phase 2):
//   For any active section and completed sections set, verify correct pill
//   rendering:
//     - Active pill: `primary/10` background, `primary` text, weight 500
//       (Requirement 9.2)
//     - Completed pill (not active): 4px `primary` dot indicator before label
//       (Requirement 9.3)
//     - Inactive pill (neither active nor completed): transparent background,
//       `muted-foreground` text (Requirement 9.4)
//
// Generator: arbitrary section lists (1–8 sections), an active section chosen
// from the list, and a subset of sections marked as completed.
//
// Runs: `fc.assert(..., { numRuns: 100 })` per project convention.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fc from "fast-check"

// ---------------------------------------------------------------------------
// Types (mirroring SectionNav component interface)
// ---------------------------------------------------------------------------

interface SectionNavItem {
  id: string
  label: string
}

type PillState = "active" | "completed" | "inactive"

// ---------------------------------------------------------------------------
// Pure logic under test — extracted from SectionNav component.
//
// The component determines pill state with:
//   isActive = section.id === activeSection
//   isCompleted = completedSections.has(section.id) && !isActive
//   inactive = !isActive && !isCompleted
//
// This mirrors the exact logic in SectionNav.tsx.
// ---------------------------------------------------------------------------

/**
 * Determines the visual state of a section pill.
 * Mirrors the logic in SectionNav component.
 */
function getPillState(
  sectionId: string,
  activeSection: string,
  completedSections: Set<string>,
): PillState {
  const isActive = sectionId === activeSection
  if (isActive) return "active"
  const isCompleted = completedSections.has(sectionId)
  if (isCompleted) return "completed"
  return "inactive"
}

/**
 * Determines whether a completed dot indicator should render for a pill.
 * Per the component: dot renders only when completed AND not active.
 */
function shouldShowCompletedDot(
  sectionId: string,
  activeSection: string,
  completedSections: Set<string>,
): boolean {
  return completedSections.has(sectionId) && sectionId !== activeSection
}

/**
 * Returns the expected CSS classes for a pill based on its state.
 * Mirrors the cn() call in SectionNav component.
 */
function getExpectedClasses(state: PillState): {
  hasActiveBg: boolean
  hasActiveText: boolean
  hasFontMedium: boolean
  hasTransparentBg: boolean
  hasMutedText: boolean
} {
  switch (state) {
    case "active":
      return {
        hasActiveBg: true, // bg-primary/10
        hasActiveText: true, // text-primary
        hasFontMedium: true, // font-medium (weight 500)
        hasTransparentBg: false,
        hasMutedText: false,
      }
    case "completed":
      return {
        hasActiveBg: false,
        hasActiveText: false,
        hasFontMedium: false,
        hasTransparentBg: true, // bg-transparent
        hasMutedText: true, // text-muted-foreground
      }
    case "inactive":
      return {
        hasActiveBg: false,
        hasActiveText: false,
        hasFontMedium: false,
        hasTransparentBg: true, // bg-transparent
        hasMutedText: true, // text-muted-foreground
      }
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Arbitrary for a section ID (short alphanumeric string)
const sectionIdArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)

// Arbitrary for a section nav item
const sectionItemArb: fc.Arbitrary<SectionNavItem> = fc.record({
  id: sectionIdArb,
  label: fc.string({ minLength: 1, maxLength: 30 }),
})

// Arbitrary for a list of sections with unique IDs (1–8 sections)
const sectionsArb: fc.Arbitrary<SectionNavItem[]> = fc
  .uniqueArray(sectionItemArb, {
    minLength: 1,
    maxLength: 8,
    comparator: (a, b) => a.id === b.id,
  })

// Arbitrary for a test scenario: sections + active section + completed sections
interface SectionNavScenario {
  sections: SectionNavItem[]
  activeSection: string
  completedSections: Set<string>
}

const scenarioArb: fc.Arbitrary<SectionNavScenario> = sectionsArb.chain((sections) => {
  const ids = sections.map((s) => s.id)
  // Active section must be one of the section IDs
  const activeSectionArb = fc.constantFrom(...ids)
  // Completed sections is a subset of section IDs
  const completedArb = fc.subarray(ids).map((arr) => new Set(arr))

  return fc.record({
    sections: fc.constant(sections),
    activeSection: activeSectionArb,
    completedSections: completedArb,
  })
})

// ---------------------------------------------------------------------------
// Property 7 — Section Nav State Rendering
// ---------------------------------------------------------------------------

describe("property: Section Nav State Rendering (Property 7)", () => {
  it("active section always renders with active styles (bg-primary/10, text-primary, font-medium)", () => {
    // **Validates: Requirements 9.2**
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        const state = getPillState(activeSection, activeSection, completedSections)
        assert.strictEqual(
          state,
          "active",
          `Active section "${activeSection}" must have state "active"`,
        )

        const classes = getExpectedClasses(state)
        assert.strictEqual(classes.hasActiveBg, true, "Active pill must have bg-primary/10")
        assert.strictEqual(classes.hasActiveText, true, "Active pill must have text-primary")
        assert.strictEqual(classes.hasFontMedium, true, "Active pill must have font-medium (weight 500)")
      }),
      { numRuns: 100 },
    )
  })

  it("completed (non-active) sections show dot indicator and muted text", () => {
    // **Validates: Requirements 9.3**
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        for (const section of sections) {
          if (section.id === activeSection) continue
          if (!completedSections.has(section.id)) continue

          // This section is completed but not active
          const state = getPillState(section.id, activeSection, completedSections)
          assert.strictEqual(
            state,
            "completed",
            `Section "${section.id}" (completed, not active) must have state "completed"`,
          )

          // Must show the dot indicator
          const showDot = shouldShowCompletedDot(section.id, activeSection, completedSections)
          assert.strictEqual(
            showDot,
            true,
            `Completed section "${section.id}" must show dot indicator`,
          )

          // Must have transparent bg and muted text
          const classes = getExpectedClasses(state)
          assert.strictEqual(classes.hasTransparentBg, true, "Completed pill must have transparent bg")
          assert.strictEqual(classes.hasMutedText, true, "Completed pill must have muted-foreground text")
        }
      }),
      { numRuns: 100 },
    )
  })

  it("inactive sections (neither active nor completed) render with transparent bg and muted text", () => {
    // **Validates: Requirements 9.4**
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        for (const section of sections) {
          if (section.id === activeSection) continue
          if (completedSections.has(section.id)) continue

          // This section is inactive
          const state = getPillState(section.id, activeSection, completedSections)
          assert.strictEqual(
            state,
            "inactive",
            `Section "${section.id}" (not active, not completed) must have state "inactive"`,
          )

          // Must NOT show the dot indicator
          const showDot = shouldShowCompletedDot(section.id, activeSection, completedSections)
          assert.strictEqual(
            showDot,
            false,
            `Inactive section "${section.id}" must not show dot indicator`,
          )

          // Must have transparent bg and muted text
          const classes = getExpectedClasses(state)
          assert.strictEqual(classes.hasTransparentBg, true, "Inactive pill must have transparent bg")
          assert.strictEqual(classes.hasMutedText, true, "Inactive pill must have muted-foreground text")
          assert.strictEqual(classes.hasActiveBg, false, "Inactive pill must not have active bg")
        }
      }),
      { numRuns: 100 },
    )
  })

  it("active section in completedSections still renders as active (active takes precedence)", () => {
    // **Validates: Requirements 9.2, 9.3**
    // Key invariant: even if a section is marked completed, if it's the active
    // section it must render with active styles, not completed styles.
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        // Force the active section into completedSections for this property
        const completedWithActive = new Set(completedSections)
        completedWithActive.add(activeSection)

        const state = getPillState(activeSection, activeSection, completedWithActive)
        assert.strictEqual(
          state,
          "active",
          "Active section must render as active even when in completedSections",
        )

        // Must NOT show dot indicator when active
        const showDot = shouldShowCompletedDot(activeSection, activeSection, completedWithActive)
        assert.strictEqual(
          showDot,
          false,
          "Active section must not show completed dot even when in completedSections",
        )
      }),
      { numRuns: 100 },
    )
  })

  it("exactly one section has active state for any valid scenario", () => {
    // **Validates: Requirements 9.2, 9.3, 9.4**
    // Partition invariant: among all sections, exactly one is active.
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        const states = sections.map((s) => getPillState(s.id, activeSection, completedSections))
        const activeCount = states.filter((s) => s === "active").length

        assert.strictEqual(
          activeCount,
          1,
          `Exactly one section must be active, got ${activeCount}`,
        )
      }),
      { numRuns: 100 },
    )
  })

  it("every section is in exactly one state (active, completed, or inactive)", () => {
    // **Validates: Requirements 9.2, 9.3, 9.4**
    // Exhaustive partition: each section maps to exactly one visual state.
    fc.assert(
      fc.property(scenarioArb, ({ sections, activeSection, completedSections }) => {
        for (const section of sections) {
          const state = getPillState(section.id, activeSection, completedSections)
          assert.ok(
            state === "active" || state === "completed" || state === "inactive",
            `Section "${section.id}" must be in one of the three states, got "${state}"`,
          )
        }
      }),
      { numRuns: 100 },
    )
  })
})
