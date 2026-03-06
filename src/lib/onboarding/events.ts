import { z } from 'zod'
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/contracts'

export type OnboardingStepId = 1 | 2 | 3 | 4

export const ONBOARDING_EVENT_TYPES = [
    'step_view',
    'step_continue',
    'step_back',
    'submit_start',
    'submit_success',
    'submit_error',
    'draft_loaded',
    'time_to_continue',
    'time_to_submit',
    'input_latency',
    'save_draft_latency',
    'step_render_time',
] as const

export type OnboardingEventType = typeof ONBOARDING_EVENT_TYPES[number]

export const onboardingEventInputSchema = z.object({
    eventType: z.enum(ONBOARDING_EVENT_TYPES),
    step: z.number().int().min(1).max(ONBOARDING_TOTAL_STEPS).optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export type OnboardingEventInput = z.infer<typeof onboardingEventInputSchema>

export function normalizeOnboardingEventInput(input: OnboardingEventInput): OnboardingEventInput {
    return onboardingEventInputSchema.parse(input)
}
