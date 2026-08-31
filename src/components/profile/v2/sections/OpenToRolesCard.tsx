'use client'

import { Briefcase, CalendarClock, Pencil } from 'lucide-react'
import { Card } from './Card'
import { cn } from '@/lib/utils'
import {
  experienceLevelLabel,
  getRolePreferences,
  rolePreferenceLabel,
  weeklyCapacityLabel,
} from '@/lib/profile/role-preferences'

interface OpenToRolesCardProps {
  openTo?: unknown
  experienceLevel?: unknown
  hoursPerWeek?: unknown
  isOwner: boolean
  onEdit?: () => void
  onInvite?: () => void
  onInviteIntent?: () => void
  onApply?: () => void
  onApplyIntent?: () => void
  hasOpenRoles?: boolean
}

export function OpenToRolesCard({
  openTo,
  experienceLevel,
  hoursPerWeek,
  isOwner,
  onEdit,
  onInvite,
  onInviteIntent,
  onApply,
  onApplyIntent,
  hasOpenRoles = false,
}: OpenToRolesCardProps) {
  const roles = getRolePreferences(openTo)
  const experience = experienceLevelLabel(experienceLevel)
  const capacity = weeklyCapacityLabel(hoursPerWeek)
  const hasPreferences = roles.length > 0 || Boolean(experience) || Boolean(capacity)

  if (!isOwner && !hasPreferences && !onInvite && !hasOpenRoles) return null

  const editAction = isOwner && onEdit ? (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Edit role preferences"
      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null

  return (
    <Card
      id="profile-open-to-roles"
      title="Open to Roles"
      density="compact"
      icon={<Briefcase className="h-4 w-4" />}
      action={editAction}
    >
      <div className="space-y-4 px-5 py-4">
        {roles.length > 0 ? (
          <ul aria-label="Preferred role types" className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <li
                key={role}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {rolePreferenceLabel(role)}
              </li>
            ))}
          </ul>
        ) : null}

        {experience || capacity ? (
          <dl className="space-y-2 text-sm">
            {experience ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">Experience</dt>
                <dd className="font-medium text-zinc-800 dark:text-zinc-200">{experience}</dd>
              </div>
            ) : null}
            {capacity ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  Weekly capacity
                </dt>
                <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{capacity}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {!hasPreferences ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {isOwner ? 'Tell people which roles and opportunities interest you.' : 'Role preferences have not been shared.'}
          </p>
        ) : null}

        {isOwner && !hasPreferences && onEdit ? (
          <button type="button" onClick={onEdit} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            Set role preferences
          </button>
        ) : null}

        {!isOwner && (hasOpenRoles || onInvite) && (
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            {hasOpenRoles && onApply && (
              <button
                type="button"
                onClick={onApply}
                onMouseEnter={onApplyIntent}
                onFocus={onApplyIntent}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150 shadow-sm",
                  onInvite
                    ? "w-full sm:w-1/2 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    : "w-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                )}
              >
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Apply to join
              </button>
            )}
            {onInvite && (
              <button
                type="button"
                onClick={onInvite}
                onMouseEnter={onInviteIntent}
                onFocus={onInviteIntent}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150 border",
                  hasOpenRoles
                    ? "w-full sm:w-1/2 bg-zinc-50 dark:bg-zinc-900 border-zinc-250 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                    : "w-full bg-zinc-50 dark:bg-zinc-900 border-zinc-250 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                )}
              >
                <Briefcase className="h-4 w-4" aria-hidden="true" />
                Invite to
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
