'use client'

import { StepHeader } from '@/components/onboarding/StepHeader'
import ChipSelector from '@/components/onboarding/ChipSelector'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import { Label } from '@/components/ui/label'

interface Step3SkillsProps {
  skillOptions: Array<{ value: string; label: string }>
  interestOptions: Array<{ value: string; label: string }>
  selectedSkills: Set<string>
  selectedInterests: Set<string>
  onToggleSkill: (value: string) => void
  onToggleInterest: (value: string) => void
}

const step3Config = STEP_UI_CONFIG.find((s) => s.id === 3)!

export default function Step3Skills({
  skillOptions,
  interestOptions,
  selectedSkills,
  selectedInterests,
  onToggleSkill,
  onToggleInterest,
}: Step3SkillsProps) {
  return (
    <div className="flex flex-col">
      <StepHeader title={step3Config.title} subtitle={step3Config.subtitle} />

      <div className="flex flex-col gap-6">
        {/* Skills section */}
        <div className="flex flex-col gap-2">
          <Label className="text-base font-medium text-foreground">
            Skills <span className="text-destructive">*</span>
          </Label>
          <ChipSelector
            options={skillOptions}
            selected={selectedSkills}
            onToggle={onToggleSkill}
            variant="multi"
            size="md"
            colorVariant="primary"
            maxVisible={12}
            expandLabel="Show more"
          />
        </div>

        {/* Interests section */}
        <div className="flex flex-col gap-2">
          <Label className="text-base font-medium text-foreground">
            Interests
          </Label>
          <ChipSelector
            options={interestOptions}
            selected={selectedInterests}
            onToggle={onToggleInterest}
            variant="multi"
            size="md"
            colorVariant="secondary"
            maxVisible={12}
            expandLabel="Show more"
          />
        </div>
      </div>
    </div>
  )
}
