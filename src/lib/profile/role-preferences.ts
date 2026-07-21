export const ROLE_PREFERENCE_OPTIONS = [
  { value: 'Full-time roles', label: 'Full-time' },
  { value: 'Part-time roles', label: 'Part-time' },
  { value: 'Contract roles', label: 'Contract' },
  { value: 'Freelance projects', label: 'Freelance' },
  { value: 'Internships', label: 'Internships' },
  { value: 'Co-founder opportunities', label: 'Co-founder' },
] as const

export type RolePreferenceValue = (typeof ROLE_PREFERENCE_OPTIONS)[number]['value']

export const EXPERIENCE_LEVEL_OPTIONS = [
  { value: 'student', label: 'Student' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'founder', label: 'Founder' },
] as const

export type ProfileExperienceLevel = (typeof EXPERIENCE_LEVEL_OPTIONS)[number]['value']

export const WEEKLY_CAPACITY_OPTIONS = [
  { value: 'lt_5', label: 'Less than 5 hours per week' },
  { value: 'h_5_10', label: '5–10 hours per week' },
  { value: 'h_10_20', label: '10–20 hours per week' },
  { value: 'h_20_40', label: '20–40 hours per week' },
  { value: 'h_40_plus', label: '40+ hours per week' },
] as const

export type WeeklyCapacity = (typeof WEEKLY_CAPACITY_OPTIONS)[number]['value']

const roleAliases = new Map<string, RolePreferenceValue>([
  ['full_time', 'Full-time roles'],
  ['full-time', 'Full-time roles'],
  ['full time', 'Full-time roles'],
  ['full-time roles', 'Full-time roles'],
  ['part_time', 'Part-time roles'],
  ['part-time', 'Part-time roles'],
  ['part time', 'Part-time roles'],
  ['part-time roles', 'Part-time roles'],
  ['contract', 'Contract roles'],
  ['contracts', 'Contract roles'],
  ['contract role', 'Contract roles'],
  ['contract roles', 'Contract roles'],
  ['freelance', 'Freelance projects'],
  ['freelance work', 'Freelance projects'],
  ['freelance projects', 'Freelance projects'],
  ['internship', 'Internships'],
  ['internships', 'Internships'],
  ['cofounder', 'Co-founder opportunities'],
  ['co-founder', 'Co-founder opportunities'],
  ['co-founder opportunities', 'Co-founder opportunities'],
])

const canonicalRoleOrder = new Map<RolePreferenceValue, number>(
  ROLE_PREFERENCE_OPTIONS.map((option, index) => [option.value, index]),
)

export function canonicalRolePreference(value: unknown): RolePreferenceValue | null {
  if (typeof value !== 'string') return null
  return roleAliases.get(value.trim().toLowerCase()) ?? null
}

export function getRolePreferences(values: unknown): RolePreferenceValue[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<RolePreferenceValue>()
  for (const value of values) {
    const canonical = canonicalRolePreference(value)
    if (canonical) seen.add(canonical)
  }
  return [...seen].sort(
    (left, right) => (canonicalRoleOrder.get(left) ?? 99) - (canonicalRoleOrder.get(right) ?? 99),
  )
}

/**
 * Replaces role-like values while retaining legacy collaboration interests.
 * This lets the role UI migrate old data without erasing unrelated preferences.
 */
export function replaceRolePreferences(
  existingValues: unknown,
  nextRoles: readonly string[],
): string[] {
  const legacyValues = Array.isArray(existingValues)
    ? existingValues.filter((value): value is string => (
        typeof value === 'string' && value.trim().length > 0 && !canonicalRolePreference(value)
      ))
    : []
  return [...legacyValues, ...getRolePreferences(nextRoles)]
}

export function rolePreferenceLabel(value: unknown): string | null {
  const canonical = canonicalRolePreference(value)
  if (!canonical) return null
  return ROLE_PREFERENCE_OPTIONS.find((option) => option.value === canonical)?.label ?? canonical
}

export function experienceLevelLabel(value: unknown): string | null {
  return EXPERIENCE_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? null
}

export function weeklyCapacityLabel(value: unknown): string | null {
  return WEEKLY_CAPACITY_OPTIONS.find((option) => option.value === value)?.label ?? null
}

export function hasRolePreferences(input: {
  openTo?: unknown
  experienceLevel?: unknown
  hoursPerWeek?: unknown
}): boolean {
  return getRolePreferences(input.openTo).length > 0
    || Boolean(experienceLevelLabel(input.experienceLevel))
    || Boolean(weeklyCapacityLabel(input.hoursPerWeek))
}
