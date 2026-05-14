/**
 * Step UI configuration constants for the onboarding redesign.
 *
 * Contains conversational titles, subtitles, and sidebar labels for all 4 steps,
 * plus the step transition animation configuration.
 */

export interface StepConfig {
  id: 1 | 2 | 3 | 4
  title: string
  subtitle: string
  sidebarLabel: string
}

export const STEP_UI_CONFIG: StepConfig[] = [
  {
    id: 1,
    title: "Let's set up your profile",
    subtitle: 'Choose a username and confirm your name',
    sidebarLabel: 'Identity',
  },
  {
    id: 2,
    title: 'Tell us about yourself',
    subtitle: 'This helps us personalize your experience',
    sidebarLabel: 'Details',
  },
  {
    id: 3,
    title: 'What are you good at?',
    subtitle: 'Pick skills and topics that describe you',
    sidebarLabel: 'Skills',
  },
  {
    id: 4,
    title: 'Privacy & visibility',
    subtitle: 'Control who sees your profile',
    sidebarLabel: 'Privacy',
  },
]

export interface StepTransition {
  enter: { opacity: number; transform: string }
  enterActive: { opacity: number; transform: string; transition: string }
  exit: { opacity: number; transform: string }
  exitActive: { opacity: number; transform: string; transition: string }
}

export const STEP_TRANSITION: StepTransition = {
  enter: { opacity: 0, transform: 'translateX(12px)' },
  enterActive: { opacity: 1, transform: 'translateX(0)', transition: 'all 200ms ease-out' },
  exit: { opacity: 1, transform: 'translateX(0)' },
  exitActive: { opacity: 0, transform: 'translateX(-12px)', transition: 'all 150ms ease-in' },
}
