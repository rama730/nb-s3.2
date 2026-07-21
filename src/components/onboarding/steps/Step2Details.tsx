'use client'

import { useMemo } from 'react'
import { MapPin, Globe, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionNav } from '@/components/onboarding/SectionNav'
import ChipSelector from '@/components/onboarding/ChipSelector'
import type { OnboardingStep2SectionId } from '@/lib/onboarding/config'
import type {
  OnboardingExperienceLevel,
  OnboardingGenderIdentity,
  OnboardingHoursPerWeek,
  OnboardingSocialLinkKey,
} from '@/lib/onboarding/contracts'
import {
  EXPERIENCE_LEVEL_OPTIONS,
  ROLE_PREFERENCE_OPTIONS,
  WEEKLY_CAPACITY_OPTIONS,
} from '@/lib/profile/role-preferences'

// --- Option constants ---

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const

// --- Section definitions for SectionNav ---

const SECTION_NAV_ITEMS = [
  { id: 'identity', label: 'Identity' },
  { id: 'work', label: 'Work prefs' },
  { id: 'profile', label: 'Profile' },
  { id: 'social', label: 'Social' },
] as const

// --- Props ---

export interface Step2DetailsProps {
  // Section navigation
  step2Section: OnboardingStep2SectionId
  onSectionChange: (sectionId: OnboardingStep2SectionId) => void

  // Identity section
  genderIdentity: OnboardingGenderIdentity | ''
  pronouns: string
  onGenderChange: (value: OnboardingGenderIdentity | '') => void
  onPronounsChange: (value: string) => void

  // Work section
  experienceLevel: OnboardingExperienceLevel | ''
  hoursPerWeek: OnboardingHoursPerWeek | ''
  openTo: string[]
  onExperienceLevelChange: (value: OnboardingExperienceLevel | '') => void
  onHoursPerWeekChange: (value: OnboardingHoursPerWeek | '') => void
  onToggleOpenTo: (value: string) => void

  // Profile section
  headline: string
  bio: string
  location: string
  website: string
  onHeadlineChange: (value: string) => void
  onBioChange: (value: string) => void
  onLocationChange: (value: string) => void
  onWebsiteChange: (value: string) => void
  isDetectingLocation?: boolean
  onDetectLocation?: () => void

  // Social section
  socialLinks: Record<OnboardingSocialLinkKey, string>
  onSocialLinkChange: (key: OnboardingSocialLinkKey, value: string) => void
}

/**
 * Step 2 — Profile Details with SectionNav.
 *
 * Visual changes from the original:
 * - SectionNav replaces sticky tabs + completion badges
 * - Identity section: ChipSelector (single mode) for gender, pronouns input
 * - Work section: shadcn Select for experience/hours (2-col grid on desktop),
 *   ChipSelector (multi) for role preferences
 * - Profile section: headline input, bio textarea (100px min-height,
 *   character counter only when content exists), location/website 2-col grid on desktop
 * - Social section: single-column layout, placeholder text showing URL prefix patterns
 * - No Clock3, Users icons in section headers
 * - No "Skip for now" buttons
 * - No sticky positioning on SectionNav
 */
export default function Step2Details({
  step2Section,
  onSectionChange,
  genderIdentity,
  pronouns,
  onGenderChange,
  onPronounsChange,
  experienceLevel,
  hoursPerWeek,
  openTo,
  onExperienceLevelChange,
  onHoursPerWeekChange,
  onToggleOpenTo,
  headline,
  bio,
  location,
  website,
  onHeadlineChange,
  onBioChange,
  onLocationChange,
  onWebsiteChange,
  isDetectingLocation = false,
  onDetectLocation,
  socialLinks,
  onSocialLinkChange,
}: Step2DetailsProps) {
  // Compute completed sections for SectionNav dot indicators
  const completedSections = useMemo(() => {
    const completed = new Set<string>()
    if (genderIdentity || pronouns) completed.add('identity')
    if (experienceLevel || hoursPerWeek || openTo.length > 0) completed.add('work')
    if (headline || bio || location || website) completed.add('profile')
    if (Object.values(socialLinks).some(Boolean)) completed.add('social')
    return completed
  }, [genderIdentity, pronouns, experienceLevel, hoursPerWeek, openTo, headline, bio, location, website, socialLinks])

  // Memoize selected sets for ChipSelector
  const selectedGender = useMemo(
    () => (genderIdentity ? new Set([genderIdentity]) : new Set<string>()),
    [genderIdentity]
  )
  const selectedOpenTo = useMemo(() => new Set(openTo), [openTo])

  return (
    <div className="flex flex-col gap-6">
      {/* Section Navigation — horizontal pills, no sticky */}
      <SectionNav
        sections={[...SECTION_NAV_ITEMS]}
        activeSection={step2Section}
        completedSections={completedSections}
        onSectionChange={(id) => onSectionChange(id as OnboardingStep2SectionId)}
      />

      {/* Subtle divider */}
      <div className="border-t border-border" />

      {/* Section content */}
      {step2Section === 'identity' && (
        <IdentitySection
          selectedGender={selectedGender}
          onGenderChange={onGenderChange}
          pronouns={pronouns}
          onPronounsChange={onPronounsChange}
        />
      )}

      {step2Section === 'work' && (
        <WorkSection
          experienceLevel={experienceLevel}
          hoursPerWeek={hoursPerWeek}
          selectedOpenTo={selectedOpenTo}
          onExperienceLevelChange={onExperienceLevelChange}
          onHoursPerWeekChange={onHoursPerWeekChange}
          onToggleOpenTo={onToggleOpenTo}
        />
      )}

      {step2Section === 'profile' && (
        <ProfileSection
          headline={headline}
          bio={bio}
          location={location}
          website={website}
          onHeadlineChange={onHeadlineChange}
          onBioChange={onBioChange}
          onLocationChange={onLocationChange}
          onWebsiteChange={onWebsiteChange}
          isDetectingLocation={isDetectingLocation}
          onDetectLocation={onDetectLocation}
        />
      )}

      {step2Section === 'social' && (
        <SocialSection
          socialLinks={socialLinks}
          onSocialLinkChange={onSocialLinkChange}
        />
      )}
    </div>
  )
}

// --- Identity Section ---

function IdentitySection({
  selectedGender,
  onGenderChange,
  pronouns,
  onPronounsChange,
}: {
  selectedGender: Set<string>
  onGenderChange: (value: OnboardingGenderIdentity | '') => void
  pronouns: string
  onPronounsChange: (value: string) => void
}) {
  const handleGenderToggle = (value: string) => {
    // Single mode: if already selected, deselect; otherwise select
    if (selectedGender.has(value)) {
      onGenderChange('')
    } else {
      onGenderChange(value as OnboardingGenderIdentity)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Gender — ChipSelector single mode */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">
          Gender (optional)
        </label>
        <ChipSelector
          options={[...GENDER_OPTIONS]}
          selected={selectedGender}
          onToggle={handleGenderToggle}
          variant="single"
          size="md"
          colorVariant="primary"
        />
      </div>

      {/* Pronouns input */}
      <div className="flex flex-col gap-2">
        <label htmlFor="pronouns" className="text-sm font-medium text-foreground">
          Pronouns (optional)
        </label>
        <Input
          id="pronouns"
          placeholder="e.g. they/them"
          value={pronouns}
          onChange={(e) => onPronounsChange(e.target.value)}
        />
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          You can always change these in settings
        </p>
      </div>
    </div>
  )
}

// --- Work Section ---

function WorkSection({
  experienceLevel,
  hoursPerWeek,
  selectedOpenTo,
  onExperienceLevelChange,
  onHoursPerWeekChange,
  onToggleOpenTo,
}: {
  experienceLevel: OnboardingExperienceLevel | ''
  hoursPerWeek: OnboardingHoursPerWeek | ''
  selectedOpenTo: Set<string>
  onExperienceLevelChange: (value: OnboardingExperienceLevel | '') => void
  onHoursPerWeekChange: (value: OnboardingHoursPerWeek | '') => void
  onToggleOpenTo: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Experience level + Hours per week — 2-col grid on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="experienceLevel" className="text-sm font-medium text-foreground">
            Experience level
          </label>
          <Select
            value={experienceLevel || undefined}
            onValueChange={(val) => onExperienceLevelChange(val as OnboardingExperienceLevel)}
          >
            <SelectTrigger id="experienceLevel">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="hoursPerWeek" className="text-sm font-medium text-foreground">
            Weekly capacity
          </label>
          <Select
            value={hoursPerWeek || undefined}
            onValueChange={(val) => onHoursPerWeekChange(val as OnboardingHoursPerWeek)}
          >
            <SelectTrigger id="hoursPerWeek">
              <SelectValue placeholder="Select hours" />
            </SelectTrigger>
            <SelectContent>
              {WEEKLY_CAPACITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Open to Roles — ChipSelector multi mode */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">Open to Roles</label>
        <ChipSelector
          options={[...ROLE_PREFERENCE_OPTIONS]}
          selected={selectedOpenTo}
          onToggle={onToggleOpenTo}
          variant="multi"
          size="md"
          colorVariant="primary"
        />
      </div>
    </div>
  )
}

// --- Profile Section ---

function ProfileSection({
  headline,
  bio,
  location,
  website,
  onHeadlineChange,
  onBioChange,
  onLocationChange,
  onWebsiteChange,
  isDetectingLocation,
  onDetectLocation,
}: {
  headline: string
  bio: string
  location: string
  website: string
  onHeadlineChange: (value: string) => void
  onBioChange: (value: string) => void
  onLocationChange: (value: string) => void
  onWebsiteChange: (value: string) => void
  isDetectingLocation?: boolean
  onDetectLocation?: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Headline */}
      <div className="flex flex-col gap-2">
        <label htmlFor="headline" className="text-sm font-medium text-foreground">
          Headline
        </label>
        <Input
          id="headline"
          placeholder="Full Stack Developer | OSS"
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
        />
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          A short tagline for your profile
        </p>
      </div>

      {/* Bio */}
      <div className="flex flex-col gap-2">
        <label htmlFor="bio" className="text-sm font-medium text-foreground">
          Bio
        </label>
        <textarea
          id="bio"
          placeholder="Tell us about yourself..."
          value={bio}
          onChange={(e) => onBioChange(e.target.value)}
          className={cn(
            'w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm',
            'ring-offset-background focus-visible:outline-none   ',
            'resize-y'
          )}
          maxLength={500}
        />
        {/* Character counter — only visible when bio has content */}
        {bio.length > 0 && (
          <p className="text-[12px] text-muted-foreground text-right">
            {bio.length}/500
          </p>
        )}
      </div>

      {/* Location + Website — 2-col grid on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="location" className="text-sm font-medium text-foreground">
            Location
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="location"
              placeholder="San Francisco, CA"
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              className="pl-10"
            />
          </div>
          {onDetectLocation && (
            <button
              type="button"
              onClick={onDetectLocation}
              disabled={isDetectingLocation}
              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 self-start min-h-[44px] sm:min-h-0 rounded focus-visible:outline-none   "
            >
              {isDetectingLocation ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {isDetectingLocation ? 'Detecting...' : 'Use my location'}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="website" className="text-sm font-medium text-foreground">
            Website
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="website"
              placeholder="https://yoursite.com"
              value={website}
              onChange={(e) => onWebsiteChange(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Social Section ---

function SocialSection({
  socialLinks,
  onSocialLinkChange,
}: {
  socialLinks: Record<OnboardingSocialLinkKey, string>
  onSocialLinkChange: (key: OnboardingSocialLinkKey, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Section intro — no Users icon */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-foreground">
          Social links (optional)
        </label>
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          Help others find you across platforms
        </p>
      </div>

      {/* Single-column layout for social links */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="githubLink" className="text-sm font-medium text-foreground">
            GitHub
          </label>
          <Input
            id="githubLink"
            placeholder="github.com/"
            value={socialLinks.github}
            onChange={(e) => onSocialLinkChange('github', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="linkedinLink" className="text-sm font-medium text-foreground">
            LinkedIn
          </label>
          <Input
            id="linkedinLink"
            placeholder="linkedin.com/in/"
            value={socialLinks.linkedin}
            onChange={(e) => onSocialLinkChange('linkedin', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="xLink" className="text-sm font-medium text-foreground">
            X (Twitter)
          </label>
          <Input
            id="xLink"
            placeholder="x.com/"
            value={socialLinks.x}
            onChange={(e) => onSocialLinkChange('x', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="portfolioLink" className="text-sm font-medium text-foreground">
            Portfolio
          </label>
          <Input
            id="portfolioLink"
            placeholder="https://"
            value={socialLinks.portfolio}
            onChange={(e) => onSocialLinkChange('portfolio', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
