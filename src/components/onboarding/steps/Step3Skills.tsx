'use client'

import { StepHeader } from '@/components/onboarding/StepHeader'
import ChipSelector from '@/components/onboarding/ChipSelector'
import { SkillPicker } from '@/components/skills/SkillPicker'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'

interface Step3SkillsProps {
  interestOptions: Array<{ value: string; label: string }>
  selectedSkills: Set<string>
  selectedInterests: Set<string>
  onToggleSkill: (value: string) => void
  onToggleInterest: (value: string) => void
}

const step3Config = STEP_UI_CONFIG.find((s) => s.id === 3)!

export default function Step3Skills({
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
          <SkillPicker
            value={[...selectedSkills]}
            onChange={(nextSkills) => {
              const next = new Set(nextSkills)
              for (const skill of selectedSkills) {
                if (!next.has(skill)) onToggleSkill(skill)
              }
              for (const skill of nextSkills) {
                if (!selectedSkills.has(skill)) onToggleSkill(skill)
              }
            }}
            maxSkills={25}
            label="Skills (required)"
            description="Search across engineering, design, product, business, and human skills."
          />
        </div>

        {/* Interests section */}
        <div className="flex flex-col gap-2">
          <label className="text-base font-medium text-foreground">
            Interests
          </label>
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
