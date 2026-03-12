// ============================================================================
// Grid Constants
// ============================================================================

export const GRID_COLS = 6;
export const GRID_ROWS_VISIBLE = 4;
export const GRID_ROWS_MAX = 8;
export const ROW_HEIGHT_PX = 140; // Base row height for the grid

// ============================================================================
// Widget Placement — stored per-user in profiles.workspace_layout
// ============================================================================

export interface WidgetPlacement {
    widgetId: string;
    col: number;      // 0-based column start (0 to GRID_COLS-1)
    row: number;      // 0-based row start
    colSpan: number;   // 1 to 3
    rowSpan: number;   // 1 to 3
}

export type WidgetCardSizeMode = 'compact' | 'standard' | 'expanded';

export interface WorkspaceQuickNotesState {
    content: string;
    updatedAt: string;
}

export interface WorkspacePinnedItem {
    type: 'task' | 'project';
    id: string;
    title: string;
    projectSlug?: string | null;
    projectKey?: string | null;
    taskNumber?: number | null;
    projectId?: string;
}

export interface WorkspaceLayout {
    version: number;
    widgets: WidgetPlacement[];
    quickNotes?: WorkspaceQuickNotesState;
    pins?: WorkspacePinnedItem[];
}

export type WorkspaceOverviewSectionKey =
    | 'tasks'
    | 'projects'
    | 'conversations'
    | 'recentActivity'
    | 'files'
    | 'mentionsRequests';

export type WidgetDataSource =
    | 'workspace'
    | 'projects'
    | 'messages'
    | 'files'
    | 'people'
    | 'profile'
    | 'local';

export type WidgetAuthScope = 'authenticated' | 'project_member' | 'owner_or_member';

export interface WidgetCapability {
    source: WidgetDataSource;
    authScope: WidgetAuthScope;
    refreshMs: number | null;
    dataBudget: {
        maxItems: number;
    };
    sections: WorkspaceOverviewSectionKey[];
}

// ============================================================================
// Widget Registry Config — static, used for the widget picker + constraints
// ============================================================================

export interface WidgetConfig {
    id: string;
    label: string;
    iconName: string;        // Lucide icon name (resolved at component level)
    iconBg: string;          // Tailwind bg class for icon wrapper
    iconColor: string;       // Tailwind text color for icon
    minColSpan: number;
    minRowSpan: number;
    maxColSpan: number;
    maxRowSpan: number;
    description: string;
    capability: WidgetCapability;
}

// ============================================================================
// Widget IDs — union type for type safety
// ============================================================================

export type WidgetId =
    | 'todays_focus'
    | 'urgent_items'
    | 'recent_messages'
    | 'my_projects'
    | 'recent_files'
    | 'project_health'
    | 'mentions_requests'
    | 'recent_activity'
    | 'pinned_items'
    | 'quick_notes'
    | 'sprint_snapshot'
    | 'quick_actions'
    | 'shortcuts'; // legacy alias (auto-migrates to quick_actions)

// ============================================================================
// Default Layout — used when user has no saved layout (NULL in DB)
// ============================================================================

export const WORKSPACE_LAYOUT_VERSION = 2;

export const DEFAULT_LAYOUT: WorkspaceLayout = {
    version: WORKSPACE_LAYOUT_VERSION,
    widgets: [
        { widgetId: 'quick_notes',       col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { widgetId: 'todays_focus',      col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { widgetId: 'urgent_items',      col: 4, row: 0, colSpan: 2, rowSpan: 1 },
        { widgetId: 'mentions_requests', col: 4, row: 1, colSpan: 2, rowSpan: 1 },
        { widgetId: 'my_projects',       col: 0, row: 2, colSpan: 2, rowSpan: 1 },
        { widgetId: 'recent_files',      col: 2, row: 2, colSpan: 2, rowSpan: 1 },
        { widgetId: 'recent_messages',   col: 4, row: 2, colSpan: 2, rowSpan: 1 },
        { widgetId: 'recent_activity',   col: 0, row: 3, colSpan: 3, rowSpan: 1 },
        { widgetId: 'project_health',    col: 3, row: 3, colSpan: 3, rowSpan: 1 },
    ],
};
