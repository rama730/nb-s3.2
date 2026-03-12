import type { WidgetCapability, WidgetConfig, WidgetId, WorkspaceOverviewSectionKey } from './types';

// ============================================================================
// Widget Registry — static config for all available widgets
// ============================================================================

function capability(
    source: WidgetCapability["source"],
    sections: WorkspaceOverviewSectionKey[],
    refreshMs: number | null,
    maxItems: number,
    authScope: WidgetCapability["authScope"] = "authenticated",
): WidgetCapability {
    return {
        source,
        authScope,
        refreshMs,
        dataBudget: { maxItems },
        sections,
    };
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetConfig> = {
    todays_focus: {
        id: 'todays_focus',
        label: "Today's Focus",
        iconName: 'Target',
        iconBg: 'bg-blue-50 dark:bg-blue-900/20',
        iconColor: 'text-blue-600 dark:text-blue-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 3,
        description: 'Active tasks assigned to you',
        capability: capability("workspace", ["tasks"], 30_000, 12),
    },
    urgent_items: {
        id: 'urgent_items',
        label: 'Urgent Items',
        iconName: 'AlertTriangle',
        iconBg: 'bg-rose-50 dark:bg-rose-900/20',
        iconColor: 'text-rose-600 dark:text-rose-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 2,
        maxRowSpan: 2,
        description: 'Overdue and high-priority tasks',
        capability: capability("workspace", ["tasks"], 30_000, 12),
    },
    recent_messages: {
        id: 'recent_messages',
        label: 'Unread Messages',
        iconName: 'MessageSquare',
        iconBg: 'bg-violet-50 dark:bg-violet-900/20',
        iconColor: 'text-violet-600 dark:text-violet-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 2,
        maxRowSpan: 2,
        description: 'Recent conversations with unread context',
        capability: capability("messages", ["conversations"], 20_000, 8),
    },
    my_projects: {
        id: 'my_projects',
        label: 'My Active Projects',
        iconName: 'FolderKanban',
        iconBg: 'bg-indigo-50 dark:bg-indigo-900/20',
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 2,
        description: 'Quick-access project list',
        capability: capability("projects", ["projects"], 30_000, 10),
    },
    recent_files: {
        id: 'recent_files',
        label: 'Recent Files',
        iconName: 'FileClock',
        iconBg: 'bg-cyan-50 dark:bg-cyan-900/20',
        iconColor: 'text-cyan-600 dark:text-cyan-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 2,
        description: 'Recently updated files across your projects',
        capability: capability("files", ["files"], 30_000, 10),
    },
    project_health: {
        id: 'project_health',
        label: 'Project Health',
        iconName: 'HeartPulse',
        iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 2,
        description: 'Open work pressure and completion trend',
        capability: capability("projects", ["projects"], 45_000, 10),
    },
    mentions_requests: {
        id: 'mentions_requests',
        label: 'Mentions & Requests',
        iconName: 'AtSign',
        iconBg: 'bg-orange-50 dark:bg-orange-900/20',
        iconColor: 'text-orange-600 dark:text-orange-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 2,
        maxRowSpan: 2,
        description: 'Incoming requests and application mentions',
        capability: capability("people", ["mentionsRequests"], 20_000, 10),
    },
    recent_activity: {
        id: 'recent_activity',
        label: 'Recent Activity',
        iconName: 'Activity',
        iconBg: 'bg-violet-50 dark:bg-violet-900/20',
        iconColor: 'text-violet-600 dark:text-violet-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 3,
        description: 'Timeline of actions in your world',
        capability: capability("workspace", ["recentActivity"], 30_000, 15),
    },
    pinned_items: {
        id: 'pinned_items',
        label: 'Pinned Items',
        iconName: 'Pin',
        iconBg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20',
        iconColor: 'text-fuchsia-600 dark:text-fuchsia-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 1,
        description: 'Quick-access pinned tasks and projects',
        capability: capability("local", [], null, 30),
    },
    quick_notes: {
        id: 'quick_notes',
        label: 'Quick Notes',
        iconName: 'StickyNote',
        iconBg: 'bg-amber-50 dark:bg-amber-900/20',
        iconColor: 'text-amber-600 dark:text-amber-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 3,
        description: 'Scratchpad for quick ideas and notes',
        capability: capability("local", [], null, 1),
    },
    sprint_snapshot: {
        id: 'sprint_snapshot',
        label: 'Sprint Snapshot',
        iconName: 'Gauge',
        iconBg: 'bg-sky-50 dark:bg-sky-900/20',
        iconColor: 'text-sky-600 dark:text-sky-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 2,
        description: 'Current active sprint status across projects',
        capability: capability("projects", ["projects"], 45_000, 10),
    },
    quick_actions: {
        id: 'quick_actions',
        label: 'Workspace Quick Actions',
        iconName: 'Zap',
        iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 1,
        description: 'Quick-action buttons for common tasks',
        capability: capability("local", [], null, 20),
    },
    // legacy widget ID support for older layouts
    shortcuts: {
        id: 'shortcuts',
        label: 'Workspace Quick Actions',
        iconName: 'Zap',
        iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        minColSpan: 1,
        minRowSpan: 1,
        maxColSpan: 3,
        maxRowSpan: 1,
        description: 'Quick-action buttons for common tasks',
        capability: capability("local", [], null, 20),
    },
};

/** Core widget catalog (12) shown in picker */
export const ALL_WIDGET_IDS: WidgetId[] = [
    'todays_focus',
    'urgent_items',
    'recent_messages',
    'my_projects',
    'recent_files',
    'project_health',
    'mentions_requests',
    'recent_activity',
    'pinned_items',
    'quick_notes',
    'sprint_snapshot',
    'quick_actions',
];

export function getRequiredOverviewSections(widgetIds: readonly string[]): Set<WorkspaceOverviewSectionKey> {
    const sections = new Set<WorkspaceOverviewSectionKey>();
    for (const widgetId of widgetIds) {
        const config = WIDGET_REGISTRY[widgetId as WidgetId];
        if (!config) continue;
        for (const section of config.capability.sections) {
            sections.add(section);
        }
    }
    return sections;
}
