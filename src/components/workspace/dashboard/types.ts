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

export interface WorkspaceLayout {
    version: number;
    widgets: WidgetPlacement[];
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
}

// ============================================================================
// Widget IDs — union type for type safety
// ============================================================================

export type WidgetId =
    | 'todays_focus'
    | 'recent_activity'
    | 'my_projects'
    | 'urgent_items'
    | 'quick_notes'
    | 'recent_messages'
    | 'shortcuts';

// ============================================================================
// Default Layout — used when user has no saved layout (NULL in DB)
// ============================================================================

export const DEFAULT_LAYOUT: WorkspaceLayout = {
    version: 1,
    widgets: [
        { widgetId: 'quick_notes',      col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { widgetId: 'todays_focus',     col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { widgetId: 'urgent_items',     col: 4, row: 0, colSpan: 2, rowSpan: 1 },
        { widgetId: 'my_projects',      col: 4, row: 1, colSpan: 2, rowSpan: 1 },
        { widgetId: 'recent_activity',  col: 0, row: 2, colSpan: 3, rowSpan: 1 },
        { widgetId: 'recent_messages',  col: 3, row: 2, colSpan: 3, rowSpan: 1 },
    ],
};
