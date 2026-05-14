# Requirements Document

## Introduction

This document captures the visual and UX requirements for the onboarding UI redesign. The redesign replaces the current single-card gradient layout with a split-pane architecture featuring a persistent sidebar, vertical stepper, refined typography, and polished interaction states — inspired by LinkedIn and GitHub's onboarding patterns. All requirements are purely presentational; no logic, validation, state management, or backend behavior changes are in scope.

## Glossary

- **Onboarding_Layout**: The top-level shell component that provides the split-pane structure (sidebar + content area) for the onboarding flow
- **Sidebar**: The persistent left rail (280px on desktop) displaying brand, progress stepper, and help link
- **Vertical_Stepper**: The step progress indicator rendered in the sidebar showing completed, current, and pending steps
- **Mobile_Progress_Bar**: The compact horizontal progress indicator (48px height) shown on viewports below 768px, replacing the sidebar
- **Step_Header**: The consistent header component for each step containing title and subtitle, left-aligned
- **Step_Footer**: The navigation component pinned to the bottom of the content area with Back and Continue buttons
- **Chip_Selector**: A reusable multi/single-select chip component used for skills, interests, open-to, and gender selection
- **Radio_Card_Group**: A selection card component used for availability, visibility, and message privacy options
- **Section_Nav**: The horizontal pill navigation within Step 2 for switching between sub-sections
- **Design_Tokens**: The set of CSS custom properties (spacing, typography, color, radius, shadow) governing the visual system
- **Content_Area**: The right-side scrollable region (max-width 560px) where step form content is rendered
- **Step_Transition**: The animated crossfade and directional slide applied when navigating between steps

## Requirements

### Requirement 1: Split-Pane Layout

**User Story:** As a user going through onboarding, I want a clean split-pane layout with persistent progress context, so that I always know where I am in the flow without visual clutter.

#### Acceptance Criteria

1. WHEN the viewport width is 768px or greater, THE Onboarding_Layout SHALL render a two-column split with the Sidebar fixed on the left and the Content_Area on the right
2. WHEN the viewport width is below 768px, THE Onboarding_Layout SHALL render a single-column layout with the Mobile_Progress_Bar at the top replacing the Sidebar
3. THE Onboarding_Layout SHALL use a flat background color (the `background` design token) with no gradient
4. THE Sidebar SHALL have a `muted` background with a subtle right border using the `border` token
5. THE Content_Area SHALL be centered within the remaining space with a maximum width of 560px, 48px top padding, and 32px bottom padding
6. WHEN the viewport width is between 768px and 1023px, THE Sidebar SHALL render at 220px width and the Content_Area SHALL have a maximum width of 480px

### Requirement 2: Vertical Stepper Progress

**User Story:** As a user, I want to see my progress through the onboarding steps at a glance, so that I understand how much remains and feel a sense of accomplishment.

#### Acceptance Criteria

1. THE Vertical_Stepper SHALL display numbered circles (24px diameter) for each step connected by vertical lines (2px wide)
2. WHEN a step is completed, THE Vertical_Stepper SHALL display a filled `primary` circle with a white checkmark icon (12px)
3. WHEN a step is the current step, THE Vertical_Stepper SHALL display a `primary/20` ring with a `primary` filled inner dot (8px) and a subtle pulse animation
4. WHEN a step is pending, THE Vertical_Stepper SHALL display a `muted` circle with a `muted-foreground` number
5. THE Vertical_Stepper SHALL color connecting lines with `primary` for completed segments and `border` for pending segments
6. THE Vertical_Stepper SHALL display a title (14px, weight 500) and subtitle (12px, `muted-foreground`) beside each step indicator
7. THE Vertical_Stepper SHALL use `aria-label="Onboarding progress"` and `aria-current="step"` on the active step

### Requirement 3: Mobile Progress Bar

**User Story:** As a mobile user, I want a compact progress indicator that does not consume excessive screen space, so that I can focus on the form content.

#### Acceptance Criteria

1. WHEN the viewport is below 768px, THE Mobile_Progress_Bar SHALL render as a 48px-height horizontal bar sticky to the top of the viewport
2. THE Mobile_Progress_Bar SHALL display horizontal dots (8px) connected by lines using the same color logic as the Vertical_Stepper
3. THE Mobile_Progress_Bar SHALL show the current step label on the left and a completion percentage on the right
4. THE Mobile_Progress_Bar SHALL have a `muted` background with a bottom `border`

### Requirement 4: Step Header

**User Story:** As a user, I want clear, scannable step titles that tell me what to do, so that I can quickly orient myself on each step.

#### Acceptance Criteria

1. THE Step_Header SHALL render the title at 24px, weight 600, `foreground` color, left-aligned
2. THE Step_Header SHALL render the subtitle at 14px, weight 400, `muted-foreground` color, 4px below the title
3. THE Step_Header SHALL have a 32px bottom margin before form content begins
4. THE Step_Header SHALL NOT render decorative icon circles

### Requirement 5: Step Footer Navigation

**User Story:** As a user, I want clear navigation controls to move between steps, so that I can progress through or revisit parts of the onboarding flow.

#### Acceptance Criteria

1. THE Step_Footer SHALL render as a flex row with `justify-between` alignment, separated from form content by a subtle `border` line with 24px top padding
2. THE Step_Footer SHALL render the Back button as a ghost variant with `muted-foreground` text (text only: "Back")
3. THE Step_Footer SHALL render the Continue button as a solid `primary` button with white text, 14px weight 500, height 40px, and minimum width 120px
4. WHEN the current step is the final step, THE Step_Footer SHALL render a "Complete setup" button with the `app-accent-gradient` background
5. WHEN the Continue button is disabled, THE Step_Footer SHALL render the button at 50% opacity with no pointer events
6. WHEN the Continue button is in a loading state, THE Step_Footer SHALL display a spinner replacing the text while preserving the button width

### Requirement 6: Chip Selector Component

**User Story:** As a user, I want visually refined selection chips that clearly communicate selected vs unselected state, so that I can easily see and modify my choices.

#### Acceptance Criteria

1. WHEN a chip is unselected, THE Chip_Selector SHALL render the chip with `background` fill, 1px `border` stroke, and `foreground` text at 13px
2. WHEN a chip is selected, THE Chip_Selector SHALL render the chip with `primary/8` fill, 1.5px `primary` stroke, `primary` text, and a 12px checkmark icon before the label
3. WHEN an unselected chip is hovered, THE Chip_Selector SHALL transition to `muted` fill with a slightly darkened border (150ms ease transition)
4. THE Chip_Selector SHALL use full-round border radius (9999px), padding of 6px 14px (sm) or 8px 16px (md), and 8px gap between chips
5. WHEN more than 12 options exist, THE Chip_Selector SHALL show the first 12 chips and collapse remaining behind a "Show more" toggle
6. THE Chip_Selector SHALL display a selection counter below the chip group (e.g., "3 selected") in `muted-foreground`

### Requirement 7: Radio Card Group Component

**User Story:** As a user, I want selection cards that clearly indicate my current choice with minimal visual noise on unselected options, so that I can make confident selections.

#### Acceptance Criteria

1. WHEN a radio card is unselected, THE Radio_Card_Group SHALL render it with `card` background, 1px `border`, and `--radius-lg` corners
2. WHEN a radio card is selected, THE Radio_Card_Group SHALL render it with `card` background, 2px `primary` border, and a subtle `primary/5` background tint
3. WHEN an unselected radio card is hovered, THE Radio_Card_Group SHALL transition the border to `primary/40` (150ms transition)
4. THE Radio_Card_Group SHALL display a small filled circle indicator (16px) with an inner dot, right-aligned, as the selection indicator
5. THE Radio_Card_Group SHALL render the label at 14px weight 500 `foreground` and description at 13px weight 400 `muted-foreground`
6. THE Radio_Card_Group SHALL use 14px 16px padding and 10px gap between cards
7. THE Radio_Card_Group SHALL use `role="radiogroup"` with `aria-labelledby` for accessibility

### Requirement 8: Step 1 — Identity Layout

**User Story:** As a new user, I want a clean identity setup step focused on username selection, so that I can quickly establish my profile identity.

#### Acceptance Criteria

1. THE Step_Header SHALL display "Let's set up your profile" as the title and "Choose a username and confirm your name" as the subtitle
2. THE Content_Area SHALL render the avatar at 64px in a compact inline row (not stacked or centered) with a "Change photo" action beside it
3. THE Content_Area SHALL render the avatar with a 2px ring using the `border` color (not 4px `primary/10`)
4. THE Content_Area SHALL render the username field with an `@` prefix indicator inside the input
5. THE Content_Area SHALL display pre-fill hints in neutral `muted-foreground` at 12px (no green color, no icon)
6. THE Step_Header SHALL NOT contain emoji characters

### Requirement 9: Step 2 — Section Navigation

**User Story:** As a user filling in profile details, I want a simple section navigation that shows my progress without visual overload, so that I can move between sub-sections efficiently.

#### Acceptance Criteria

1. THE Section_Nav SHALL render as a single row of horizontal pills (not tabs + separate completion badges)
2. WHEN a section pill is active, THE Section_Nav SHALL render it with `primary/10` background, `primary` text, and weight 500
3. WHEN a section pill represents a completed section, THE Section_Nav SHALL display a small dot indicator (4px `primary` circle) before the label
4. WHEN a section pill is inactive, THE Section_Nav SHALL render it with transparent background and `muted-foreground` text
5. THE Section_Nav SHALL use 8px 14px padding per pill, 6px gap between pills, and `--radius-lg` border radius
6. THE Section_Nav SHALL NOT use sticky positioning — it scrolls with the content

### Requirement 10: Step 2 — Form Field Styling

**User Story:** As a user, I want consistently styled form fields with clear visual hierarchy, so that I can fill in my details without confusion.

#### Acceptance Criteria

1. THE Content_Area SHALL render select dropdowns using the shadcn Select component (not native `<select>` elements)
2. WHEN two select fields appear together (experience level and hours per week), THE Content_Area SHALL render them in a 2-column grid on desktop and stacked on mobile
3. THE Content_Area SHALL render social link inputs in a single-column layout (not 2-column grid)
4. THE Content_Area SHALL display social link inputs with placeholder text showing the expected URL prefix pattern (e.g., "github.com/")
5. THE Content_Area SHALL render the bio textarea with a minimum height of 100px and a right-aligned character counter that only appears when the bio has content

### Requirement 11: Step 3 — Skills and Interests

**User Story:** As a user, I want to select my skills and interests without feeling overwhelmed by too many options at once, so that I can make thoughtful selections.

#### Acceptance Criteria

1. THE Step_Header SHALL display "What are you good at?" as the title and "Pick skills and topics that describe you" as the subtitle
2. THE Chip_Selector for skills SHALL use the `primary` color variant when chips are selected
3. THE Chip_Selector for interests SHALL use a secondary color variant (e.g., `chart-2`) when chips are selected, visually differentiating them from skills
4. THE Step_Header SHALL NOT render the Sparkles icon or any decorative icon

### Requirement 12: Step 4 — Privacy and Review

**User Story:** As a user completing onboarding, I want to review my privacy settings and see a summary of my profile, so that I feel confident before submitting.

#### Acceptance Criteria

1. THE Step_Header SHALL display "Privacy & visibility" as the title and "Control who sees your profile" as the subtitle
2. THE Content_Area SHALL render the review summary as a single-column key-value list (not a 2-column grid)
3. THE Content_Area SHALL render the review summary card with a `muted` background and `border`, without special styling
4. THE Step_Header SHALL NOT render the Shield icon or any decorative icon
5. THE Content_Area SHALL NOT display the "Message privacy controls DM access..." hint text — the radio card descriptions are sufficient

### Requirement 13: Step Transitions and Animations

**User Story:** As a user navigating between steps, I want smooth transitions that provide directional context, so that I understand the flow direction.

#### Acceptance Criteria

1. WHEN navigating forward, THE Step_Transition SHALL fade out the current content to the left (150ms) and fade in new content from the right (200ms ease-out)
2. WHEN navigating backward, THE Step_Transition SHALL fade out the current content to the right (150ms) and fade in new content from the left (200ms ease-out)
3. WHEN switching sections within Step 2, THE Step_Transition SHALL apply a cross-fade only (150ms) with no directional movement
4. WHEN the user has `prefers-reduced-motion` enabled or the app's `data-reduce-motion` attribute is set, THE Step_Transition SHALL perform an instant swap with no animation
5. THE Vertical_Stepper SHALL animate completed steps with a circle fill (200ms ease) and checkmark scale-in (150ms spring)
6. THE Vertical_Stepper SHALL animate the current step ring with a subtle pulse (2s infinite, opacity 0.2 to 0.4)

### Requirement 14: Responsive Behavior

**User Story:** As a user on any device, I want the onboarding flow to adapt gracefully to my screen size, so that I have a comfortable experience regardless of device.

#### Acceptance Criteria

1. WHEN the viewport is 1024px or greater, THE Onboarding_Layout SHALL render the Sidebar at 280px and center the Content_Area at max 560px
2. WHEN the viewport is between 768px and 1023px, THE Onboarding_Layout SHALL render the Sidebar at 220px and the Content_Area at max 480px
3. WHEN the viewport is below 768px, THE Onboarding_Layout SHALL collapse all 2-column grids to single-column layouts
4. WHEN the viewport is below 768px, THE Content_Area SHALL render the avatar centered above the form (not in an inline row)
5. WHEN the viewport is below 360px, THE Step_Footer SHALL stack buttons vertically at full width
6. THE Onboarding_Layout SHALL ensure all interactive elements maintain a minimum 44px touch target on mobile

### Requirement 15: Design Token Compliance

**User Story:** As a user with a customized theme, I want the onboarding flow to respect my chosen accent theme and density settings, so that the experience feels cohesive with the rest of the application.

#### Acceptance Criteria

1. THE Onboarding_Layout SHALL use only existing CSS custom properties for all color values — no hardcoded color values
2. THE Onboarding_Layout SHALL render correctly with all accent themes (default, orchid, forest, ember, rose, lagoon)
3. THE Onboarding_Layout SHALL render correctly with all density settings (compact, default, comfortable)
4. THE Onboarding_Layout SHALL apply the defined spacing tokens (`--onb-space-xs` through `--onb-space-2xl`) consistently across all steps
5. THE Onboarding_Layout SHALL use the defined typography scale (step title 24px/600, subtitle 14px/400, field label 14px/500, hint 12px/400) consistently

### Requirement 16: Accessibility

**User Story:** As a user relying on assistive technology, I want the onboarding flow to be fully navigable and understandable, so that I can complete setup independently.

#### Acceptance Criteria

1. THE Onboarding_Layout SHALL maintain a minimum color contrast ratio of 4.5:1 for body text and 3:1 for large text (WCAG AA)
2. THE Chip_Selector SHALL use `role="group"` with individual `aria-pressed` attributes on each chip
3. WHEN a step transition occurs, THE Onboarding_Layout SHALL move focus to the Step_Header of the new step
4. THE Onboarding_Layout SHALL ensure all focus indicators use the existing `ring` system (2px offset ring)
5. THE Vertical_Stepper SHALL use semantic navigation markup with `aria-label` and `aria-current` attributes

### Requirement 17: Interaction States

**User Story:** As a user interacting with form elements, I want clear visual feedback for hover, focus, error, and disabled states, so that I understand the state of each element.

#### Acceptance Criteria

1. WHEN an input field is in its default state, THE Content_Area SHALL render it with 1px `border` and `background` fill
2. WHEN an input field receives focus, THE Content_Area SHALL render it with a 2px ring offset using the `ring` token
3. WHEN an input field has a validation error, THE Content_Area SHALL render it with 1.5px `destructive` border and `destructive/5` background
4. WHEN an input field is disabled, THE Content_Area SHALL render it with `border` at 50% opacity and `muted` background
5. WHEN the primary button is hovered, THE Step_Footer SHALL darken the `primary` background by 5%
6. WHEN the primary button is active (pressed), THE Step_Footer SHALL darken the `primary` background by 10%

### Requirement 18: Dark Mode Support

**User Story:** As a user with dark mode enabled, I want the onboarding flow to render correctly in dark mode, so that the experience is comfortable in low-light environments.

#### Acceptance Criteria

1. THE Onboarding_Layout SHALL reference only CSS variables that have dark mode equivalents for all surface colors
2. THE Sidebar SHALL use the `card` token (neutral-800) as its background in dark mode
3. THE Content_Area SHALL use the `card` token as its background in dark mode
4. THE Chip_Selector SHALL maintain the same selected/unselected visual logic using token-based colors that adapt to dark mode
