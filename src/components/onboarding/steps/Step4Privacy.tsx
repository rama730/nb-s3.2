'use client'

import RadioCardGroup from '@/components/onboarding/RadioCardGroup'
import { StepHeader } from '@/components/onboarding/StepHeader'
import type { OnboardingMessagePrivacy, OnboardingVisibility } from '@/lib/onboarding/contracts'

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', description: 'Anyone can view your profile' },
  { value: 'connections', label: 'Connections only', description: 'Only your connections can view' },
  { value: 'private', label: 'Private', description: 'Only you can view your profile' },
]

const MESSAGE_PRIVACY_OPTIONS = [
  { value: 'everyone', label: 'Everyone', description: 'Anyone can send you messages' },
  { value: 'connections', label: 'Connections only', description: 'Only your connections' },
]

interface ReviewSummaryItem {
  label: string
  value: string
}

interface Step4PrivacyProps {
  visibility: OnboardingVisibility
  messagePrivacy: OnboardingMessagePrivacy
  onVisibilityChange: (value: OnboardingVisibility) => void
  onMessagePrivacyChange: (value: OnboardingMessagePrivacy) => void
  /** Summary items to display in the review card */
  summaryItems: ReviewSummaryItem[]
  /** Optional error message */
  error?: string | null
}

export function Step4Privacy({
  visibility,
  messagePrivacy,
  onVisibilityChange,
  onMessagePrivacyChange,
  summaryItems,
  error,
}: Step4PrivacyProps) {
  return (
    <div>
      <StepHeader
        title="Privacy & visibility"
        subtitle="Control who sees your profile"
      />

      {/* Profile visibility */}
      <div>
        <h2 className="mb-3 text-[14px] font-medium text-foreground">
          Profile visibility
        </h2>
        <RadioCardGroup
          options={VISIBILITY_OPTIONS}
          selected={visibility}
          onChange={(val) => onVisibilityChange(val as OnboardingVisibility)}
          labelledBy="profile-visibility-label"
        />
        <span id="profile-visibility-label" className="sr-only">
          Profile visibility
        </span>
      </div>

      {/* 24px gap between visibility and messaging sections */}
      <div className="h-6" />

      {/* Message privacy */}
      <div>
        <h2 className="mb-3 text-[14px] font-medium text-foreground">
          Who can message you?
        </h2>
        <RadioCardGroup
          options={MESSAGE_PRIVACY_OPTIONS}
          selected={messagePrivacy}
          onChange={(val) => onMessagePrivacyChange(val as OnboardingMessagePrivacy)}
          labelledBy="message-privacy-label"
        />
        <span id="message-privacy-label" className="sr-only">
          Who can message you?
        </span>
      </div>

      {/* 32px gap before review summary */}
      <div className="h-8" />

      {/* Review summary — single-column key-value list with muted background and border */}
      <div className="rounded-lg border bg-muted p-4">
        <p className="mb-3 text-[14px] font-medium text-foreground">
          Your profile summary
        </p>
        <dl className="space-y-2">
          {summaryItems.map((item) => (
            <div key={item.label} className="flex items-baseline gap-2 text-[13px]">
              <dt className="text-muted-foreground">{item.label}:</dt>
              <dd className="text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
