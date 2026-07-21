/**
 * Single source of truth for durable profile and lifecycle status labels.
 */

// ---------------------------------------------------------------------------
// Experience Level
// ---------------------------------------------------------------------------

export function getExperienceLabel(level: string | null | undefined): string {
    switch (level) {
        case 'student':
            return 'Student';
        case 'junior':
            return 'Junior';
        case 'mid':
            return 'Mid-level';
        case 'senior':
            return 'Senior';
        case 'lead':
            return 'Lead';
        case 'founder':
            return 'Founder';
        default:
            return '';
    }
}

export function buildProfileStatusSummary(input: {
    experienceLevel?: string | null | undefined;
    activeLabel?: string | null | undefined;
}) {
    const parts: string[] = [];

    const experienceLabel = getExperienceLabel(input.experienceLevel);
    if (experienceLabel) {
        parts.push(experienceLabel);
    }

    if (input.activeLabel) {
        parts.push(input.activeLabel);
    }

    return { parts };
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

export function getLifecycleStatusStyle(status: string): LifecycleStatusStyle {
    const style = LIFECYCLE_STATUS_STYLES[status];
    if (style) return style;
    return {
        label: "Pending",
        dotColor: "bg-amber-500",
        textColor: "text-amber-600 dark:text-amber-400",
    };
}
