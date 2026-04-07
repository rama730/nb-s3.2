/**
 * C4 + C5: Single source of truth for availability status and experience level configs.
 */

// ---------------------------------------------------------------------------
// Availability Status
// ---------------------------------------------------------------------------

export const AVAILABILITY_CONFIG: Record<string, { color: string; label: string }> = {
    available: { color: 'text-emerald-500', label: 'Available' },
    busy: { color: 'text-amber-500', label: 'Busy' },
    focusing: { color: 'text-blue-500', label: 'Focusing' },
    offline: { color: 'text-zinc-400', label: 'Offline' },
};

export function getAvailabilityLabel(status: string | null | undefined): string {
    return AVAILABILITY_CONFIG[status || '']?.label ?? 'Available';
}

export function getAvailabilityColor(status: string | null | undefined): string {
    return AVAILABILITY_CONFIG[status || '']?.color ?? 'text-zinc-400';
}

// ---------------------------------------------------------------------------
// Experience Level
// ---------------------------------------------------------------------------

export const EXPERIENCE_LABELS: Record<string, string> = {
    student: 'Student',
    junior: 'Junior',
    mid: 'Mid-level',
    senior: 'Senior',
    lead: 'Lead',
    founder: 'Founder',
};

export function getExperienceLabel(level: string | null | undefined): string {
    return EXPERIENCE_LABELS[level || ''] ?? '';
}

// ---------------------------------------------------------------------------
// Lifecycle / Request Status (M5: shared across connections + applications)
// ---------------------------------------------------------------------------

export type LifecycleStatusStyle = {
    label: string;
    dotColor: string;
    textColor: string;
};

const LIFECYCLE_STATUS_STYLES: Record<string, LifecycleStatusStyle> = {
    pending: {
        label: "Pending",
        dotColor: "bg-amber-500",
        textColor: "text-amber-600 dark:text-amber-400",
    },
    accepted: {
        label: "Accepted",
        dotColor: "bg-emerald-500",
        textColor: "text-emerald-600 dark:text-emerald-400",
    },
    rejected: {
        label: "Declined",
        dotColor: "bg-zinc-400 dark:bg-zinc-600",
        textColor: "text-zinc-500 dark:text-zinc-400",
    },
    withdrawn: {
        label: "Withdrawn",
        dotColor: "bg-zinc-400 dark:bg-zinc-600",
        textColor: "text-zinc-500 dark:text-zinc-400",
    },
    cancelled: {
        label: "Cancelled",
        dotColor: "bg-zinc-400 dark:bg-zinc-600",
        textColor: "text-zinc-500 dark:text-zinc-400",
    },
    disconnected: {
        label: "Disconnected",
        dotColor: "bg-zinc-400 dark:bg-zinc-600",
        textColor: "text-zinc-500 dark:text-zinc-400",
    },
    role_filled: {
        label: "Role Filled",
        dotColor: "bg-blue-500",
        textColor: "text-blue-600 dark:text-blue-400",
    },
};

const FALLBACK_LIFECYCLE_STATUS = LIFECYCLE_STATUS_STYLES.pending;

export function getLifecycleStatusStyle(status: string): LifecycleStatusStyle {
    return LIFECYCLE_STATUS_STYLES[status] ?? FALLBACK_LIFECYCLE_STATUS;
}
