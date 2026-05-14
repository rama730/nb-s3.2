# Implementation Plan: Onboarding UI Redesign

## Overview

A comprehensive visual redesign of the 4-step onboarding flow, replacing the current single-card gradient layout with a split-pane architecture featuring a persistent sidebar, vertical stepper, refined typography, and polished interaction states. Implementation uses TypeScript/React (Next.js) with existing shadcn/ui components and Tailwind CSS. No logic, validation, state management, or backend changes are in scope.

## Tasks

- [x] 1. Set up design tokens and shared infrastructure
  - [x] 1.1 Create onboarding design tokens CSS file
    - Create `src/styles/onboarding-tokens.css` defining all spacing tokens (`--onb-space-xs` through `--onb-space-2xl`), typography scale, border radius, and shadow values
    - Import the token file in the onboarding layout
    - Ensure tokens reference existing CSS custom properties for colors (no hardcoded values)
    - _Requirements: 15.1, 15.4, 15.5_

  - [x] 1.2 Add shadcn Select component
    - Install/generate the shadcn `Select` component into `src/components/ui/select.tsx`
    - Verify it integrates with existing Tailwind config and design tokens
    - _Requirements: 10.1_

  - [x] 1.3 Create step UI configuration constants
    - Create `src/lib/onboarding/step-ui-config.ts` with `STEP_UI_CONFIG` array containing conversational titles, subtitles, and sidebar labels for all 4 steps
    - Define the `StepTransition` animation config object
    - _Requirements: 4.1, 4.2, 8.1, 11.1, 12.1, 13.1, 13.2_

- [x] 2. Implement reusable components
  - [x] 2.1 Implement ChipSelector component
    - Create `src/components/onboarding/ChipSelector.tsx` with props: options, selected, onToggle, variant (single/multi), size (sm/md), colorVariant (primary/secondary), maxVisible, expandLabel
    - Implement unselected state: `background` fill, 1px `border`, `foreground` text at 13px
    - Implement selected state: tinted background (`primary/8` or `chart-2/8`), 1.5px colored stroke, colored text, 12px checkmark icon
    - Implement hover state with 150ms ease transition
    - Implement "Show more" collapse when options exceed maxVisible (default 12)
    - Implement selection counter below chip group
    - Add `role="group"` with `aria-pressed` on each chip
    - Use full-round border radius (9999px), proper padding and gap
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 16.2_

  - [x] 2.2 Write property tests for ChipSelector
    - **Property 3: Chip Selection Visual State** — For any set of options and selected values, verify correct rendering of selected vs unselected styles
    - **Property 4: Chip Overflow Collapse** — For any options list > 12 items, verify only first 12 are visible initially
    - **Property 5: Chip Selection Counter** — For any selected set, verify counter displays exact count
    - **Validates: Requirements 6.1, 6.2, 6.5, 6.6**

  - [x] 2.3 Implement RadioCardGroup component
    - Create `src/components/onboarding/RadioCardGroup.tsx` with props: options, selected, onChange, columns (1 | 2)
    - Implement unselected state: `card` background, 1px `border`, `--radius-lg` corners
    - Implement selected state: 2px `primary` border, `primary/5` background tint, filled circle indicator (16px)
    - Implement hover state: border transitions to `primary/40` (150ms)
    - Render label at 14px/500 and description at 13px/400
    - Use 14px 16px padding and 10px gap between cards
    - Add `role="radiogroup"` with `aria-labelledby`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 2.4 Write property test for RadioCardGroup
    - **Property 6: Radio Card Selection State** — For any options and selected value, verify matching option has selected styles and all others have unselected styles
    - **Validates: Requirements 7.1, 7.2**

  - [x] 2.5 Implement SectionNav component
    - Create `src/components/onboarding/SectionNav.tsx` with props: sections, activeSection, completedSections, onSectionChange
    - Implement active pill: `primary/10` background, `primary` text, weight 500
    - Implement completed pill: 4px `primary` dot indicator before label
    - Implement inactive pill: transparent background, `muted-foreground` text
    - Use 8px 14px padding, 6px gap, `--radius-lg` border radius
    - Do NOT use sticky positioning — scrolls with content
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 2.6 Write property test for SectionNav
    - **Property 7: Section Nav State Rendering** — For any active section and completed sections set, verify correct pill rendering
    - **Validates: Requirements 9.2, 9.3, 9.4**

- [x] 3. Implement layout shell components
  - [x] 3.1 Implement OnboardingLayout (SplitPane shell)
    - Create `src/components/onboarding/OnboardingLayout.tsx` replacing the current gradient layout
    - Desktop (≥768px): two-column split with sidebar fixed left and content scrollable right
    - Tablet (768–1023px): sidebar at 220px, content max 480px
    - Desktop (≥1024px): sidebar at 280px, content max 560px centered
    - Mobile (<768px): single column with MobileProgressBar at top
    - Use flat `background` color (no gradient)
    - Content area: centered, generous vertical padding (48px top, 32px bottom)
    - Ensure all interactive elements maintain 44px minimum touch target on mobile
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 14.1, 14.2, 14.6, 15.1_

  - [x] 3.2 Implement OnboardingSidebar with VerticalStepper
    - Create `src/components/onboarding/OnboardingSidebar.tsx`
    - Width: 280px fixed (220px on tablet breakpoint)
    - Top: brand logo/mark (24px height) + app name
    - Middle: VerticalStepper with numbered circles (24px diameter)
    - Completed steps: filled `primary` circle with white checkmark (12px)
    - Current step: `primary/20` ring with `primary` inner dot (8px), pulse animation
    - Pending steps: `muted` circle with `muted-foreground` number
    - Connecting lines: 2px wide, `primary` for completed, `border` for pending
    - Step labels: title (14px/500) and subtitle (12px/muted-foreground)
    - Bottom: "Need help?" link in `muted-foreground` at 12px
    - Add `aria-label="Onboarding progress"` and `aria-current="step"` on active step
    - Sidebar background: `muted` with right `border`
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 16.5_

  - [x] 3.3 Write property test for VerticalStepper state rendering
    - **Property 1: Stepper State Rendering** — For any currentStep (1–4), verify each step indicator renders correct visual state (completed/current/pending) with correct connecting line colors
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**

  - [x] 3.4 Implement MobileProgressBar
    - Create `src/components/onboarding/MobileProgressBar.tsx`
    - 48px height, sticky to top of viewport on mobile
    - Horizontal dots (8px) connected by lines with same color logic as VerticalStepper
    - Current step label on left, completion percentage on right
    - Background: `muted`, bottom border: `border`
    - Only renders when viewport < 768px
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.5 Write property test for MobileProgressBar percentage
    - **Property 2: Mobile Progress Percentage** — For any currentStep (1–4), verify displayed percentage equals ((currentStep - 1) / totalSteps) × 100 rounded to nearest integer
    - **Validates: Requirements 3.3**

  - [x] 3.6 Implement StepHeader component
    - Create `src/components/onboarding/StepHeader.tsx`
    - Title: 24px, weight 600, `foreground`, left-aligned
    - Subtitle: 14px, weight 400, `muted-foreground`, 4px below title
    - 32px bottom margin before form content
    - NO decorative icon circles, NO emoji
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.6, 11.4, 12.4_

  - [x] 3.7 Implement StepFooter component
    - Create `src/components/onboarding/StepFooter.tsx`
    - Flex row, `justify-between`, separated from form content by `border` line with 24px top padding
    - Back button: ghost variant, `muted-foreground`, text only "Back"
    - Continue button: solid `primary`, white text, 14px/500, height 40px, min-width 120px
    - Final step: "Complete setup" with `app-accent-gradient` background
    - Disabled state: 50% opacity, no pointer events
    - Loading state: spinner replaces text, button width preserved
    - Hover: primary darkened 5%; Active: primary darkened 10%
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 17.5, 17.6_

  - [x] 3.8 Write property test for disabled button state
    - **Property 14: Disabled Button State** — For any step where proceed condition is not met, verify Continue button renders at 50% opacity with pointer-events disabled
    - **Validates: Requirements 5.5**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement step transition system
  - [x] 5.1 Implement step transition animations
    - Create `src/components/onboarding/StepTransition.tsx` wrapper component
    - Forward navigation: fade out left (150ms), fade in from right (200ms ease-out)
    - Backward navigation: fade out right (150ms), fade in from left (200ms ease-out)
    - Section change (Step 2): cross-fade only (150ms), no directional movement
    - Use CSS transforms only (GPU-accelerated, no layout thrash)
    - Respect `prefers-reduced-motion` and `data-reduce-motion` — instant swap when enabled
    - Move focus to StepHeader after transition completes
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 16.3_

  - [x] 5.2 Write property test for reduced motion compliance
    - **Property 8: Reduced Motion Compliance** — For any step transition, when prefers-reduced-motion is enabled, verify instant swap with no animation
    - **Validates: Requirements 13.4**

  - [x] 5.3 Write property test for focus management on step transition
    - **Property 12: Focus Management on Step Transition** — For any step navigation, verify focus moves to StepHeader of newly active step
    - **Validates: Requirements 16.3**

  - [x] 5.4 Implement stepper animations
    - Add completed step animation: circle fill (200ms ease) + checkmark scale-in (150ms spring)
    - Add current step pulse animation (2s infinite, opacity 0.2 → 0.4)
    - Add line segment fill animation (300ms ease) on step completion
    - _Requirements: 13.5, 13.6_

- [x] 6. Implement per-step content redesigns
  - [x] 6.1 Redesign Step 1 — Identity layout
    - Update Step 1 content to use new layout structure
    - Avatar: 64px, compact inline row (not stacked), 2px ring using `border` color
    - "Change photo" action beside avatar
    - Username field with `@` prefix indicator inside input
    - Pre-fill hints in neutral `muted-foreground` at 12px (no green, no icon)
    - No emoji in headings, left-aligned everything
    - Mobile: avatar centered above form (not inline row)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 14.4_

  - [x] 6.2 Redesign Step 2 — Profile Details with SectionNav
    - Replace sticky tabs + completion badges with SectionNav component
    - Wire SectionNav to existing step2Section state
    - Implement Identity section: ChipSelector (single mode) for gender, pronouns input
    - Implement Work section: shadcn Select for experience/hours, ChipSelector (multi) for open-to, RadioCardGroup for availability
    - Implement Profile section: headline input, bio textarea (100px min-height, character counter visible only when content exists), location/website 2-col grid on desktop
    - Implement Social section: single-column layout, placeholder text showing URL prefix patterns
    - Remove decorative icons (Clock3, Users) from section headers
    - Remove "Skip for now" buttons — fields are already optional
    - 2-column grid for selects on desktop, stacked on mobile
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.3 Redesign Step 3 — Skills and Interests
    - Use ChipSelector with `primary` colorVariant for skills
    - Use ChipSelector with `secondary` colorVariant (chart-2) for interests
    - Conversational title: "What are you good at?"
    - No Sparkles icon or decorative icons
    - maxVisible=12 with "Show more" toggle on both chip groups
    - Selection counters below each group
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 6.4 Redesign Step 4 — Privacy and Review
    - RadioCardGroup for profile visibility (Public, Connections only, Private)
    - RadioCardGroup for message privacy (Everyone, Connections only)
    - Review summary: single-column key-value list with `muted` background and `border`
    - No Shield icon, no "Message privacy controls DM access..." hint
    - "Complete setup" button with gradient in footer
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement interaction states and input styling
  - [x] 8.1 Implement input field interaction states
    - Default: 1px `border`, `background` fill
    - Focus: 2px ring offset using `ring` token
    - Error: 1.5px `destructive` border, `destructive/5` background
    - Disabled: `border` at 50% opacity, `muted` background
    - Apply consistently across all onboarding form inputs
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 8.2 Write property test for input field state rendering
    - **Property 13: Input Field State Rendering** — For any input field, verify correct visual treatment for each state (default, focus, error, disabled)
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4**

- [x] 9. Implement responsive behavior and dark mode
  - [x] 9.1 Implement responsive breakpoint behavior
    - Verify all 2-column grids collapse to single column below 768px
    - Step footer: stack buttons vertically at full width below 360px
    - Avatar in Step 1: centered above form on mobile
    - Content area: 16px horizontal padding on mobile
    - _Requirements: 14.3, 14.4, 14.5, 14.6_

  - [x] 9.2 Write property test for responsive grid collapse
    - **Property 16: Responsive Grid Collapse** — For any 2-column grid, verify collapse to single column below 768px
    - **Validates: Requirements 14.3**

  - [x] 9.3 Verify dark mode support
    - Ensure all color references use CSS variables with dark mode equivalents
    - Sidebar uses `card` token (neutral-800) in dark mode
    - Content area uses `card` token in dark mode
    - ChipSelector maintains visual logic with token-based colors in dark mode
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 9.4 Verify theme and density compatibility
    - Test rendering with all accent themes (default, orchid, forest, ember, rose, lagoon)
    - Test rendering with all density settings (compact, default, comfortable)
    - Ensure no visual overflow, clipping, or misalignment
    - _Requirements: 15.2, 15.3_

- [x] 10. Wire components into onboarding page
  - [x] 10.1 Integrate layout shell into onboarding page
    - Replace current Card-based layout in `src/app/(onboarding)/onboarding/page.tsx` with OnboardingLayout
    - Wire OnboardingSidebar/MobileProgressBar with existing step state
    - Wire StepHeader with STEP_UI_CONFIG for each step
    - Wire StepFooter with existing navigation handlers (nextStep, prevStep, canProceed, isLoading)
    - Wrap step content in StepTransition component
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 5.1, 13.1_

  - [x] 10.2 Wire reusable components into step content
    - Replace existing chip/tag implementations with ChipSelector in Steps 2 and 3
    - Replace existing radio/select implementations with RadioCardGroup in Steps 2 and 4
    - Replace native `<select>` elements with shadcn Select in Step 2
    - Wire SectionNav into Step 2 section navigation
    - Ensure all existing state management and validation logic remains unchanged
    - _Requirements: 6.1, 7.1, 9.1, 10.1, 11.2, 12.2_

- [x] 11. Accessibility and final polish
  - [x] 11.1 Implement accessibility requirements
    - Verify minimum 4.5:1 contrast ratio for body text, 3:1 for large text
    - Ensure all focus indicators use existing `ring` system (2px offset ring)
    - Verify `aria-label`, `aria-current`, `role="radiogroup"`, `role="group"`, `aria-pressed` attributes
    - Ensure 44px minimum touch targets on mobile
    - Verify focus moves to StepHeader on step transitions
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 11.2 Write property test for no decorative icons in step headers
    - **Property 15: No Decorative Icons in Step Headers** — For any step (1–4), verify StepHeader does not render decorative icon circles, emoji, or Sparkles/Shield icons
    - **Validates: Requirements 4.4, 8.6, 11.4, 12.4**

  - [x] 11.3 Write property test for no hardcoded colors
    - **Property 9: No Hardcoded Colors** — For any color-related style in onboarding components, verify value references a CSS custom property
    - **Validates: Requirements 15.1, 18.1**

  - [x] 11.4 Write property test for touch target minimum size
    - **Property 11: Touch Target Minimum Size** — For any interactive element on mobile viewport, verify touch target is at least 44px × 44px
    - **Validates: Requirements 14.6**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- No logic, validation, state management, or backend behavior changes are in scope — this is purely visual
- The shadcn `Select` component is the only new UI dependency needed
- All animations use CSS transforms only for GPU acceleration
- Existing `cn()` utility is used for conditional class composition

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.5", "3.6", "3.7"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "3.1", "3.4", "3.8"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "5.1", "5.4"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1", "6.3", "6.4"] },
    { "id": 5, "tasks": ["6.2", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1", "9.3", "9.4"] },
    { "id": 7, "tasks": ["9.2", "10.1"] },
    { "id": 8, "tasks": ["10.2"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4"] }
  ]
}
```
