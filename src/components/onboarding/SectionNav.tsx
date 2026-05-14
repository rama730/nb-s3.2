"use client"

import { cn } from "@/lib/utils"

export interface SectionNavItem {
  id: string
  label: string
}

export interface SectionNavProps {
  sections: SectionNavItem[]
  activeSection: string
  completedSections: Set<string>
  onSectionChange: (sectionId: string) => void
}

/**
 * Horizontal pill navigation for switching between sub-sections within a step.
 * Renders as a single row of pills — no sticky positioning, scrolls with content.
 *
 * Visual states:
 * - Active: primary/10 background, primary text, weight 500
 * - Completed: 4px primary dot before label
 * - Inactive: transparent background, muted-foreground text
 */
export function SectionNav({
  sections,
  activeSection,
  completedSections,
  onSectionChange,
}: SectionNavProps) {
  return (
    <nav aria-label="Section navigation" className="flex flex-wrap gap-1.5">
      {sections.map((section) => {
        const isActive = section.id === activeSection
        const isCompleted = completedSections.has(section.id) && !isActive

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSectionChange(section.id)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex items-center rounded-[var(--radius-lg)] px-3.5 py-2 text-sm transition-colors",
              "min-h-[44px] sm:min-h-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "bg-primary/10 font-medium text-primary",
              isCompleted && "bg-transparent text-muted-foreground",
              !isActive && !isCompleted && "bg-transparent text-muted-foreground"
            )}
          >
            {isCompleted && (
              <span
                className="mr-1.5 inline-block h-1 w-1 rounded-full bg-primary"
                aria-hidden="true"
              />
            )}
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}
