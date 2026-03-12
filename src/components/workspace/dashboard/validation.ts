import { z } from 'zod';
import { GRID_COLS, GRID_ROWS_MAX, DEFAULT_LAYOUT, WORKSPACE_LAYOUT_VERSION } from './types';
import type { WorkspaceLayout, WidgetPlacement } from './types';
import { WIDGET_REGISTRY } from './widgetRegistry';

// ============================================================================
// Zod Schemas — used both client + server side
// ============================================================================

const MAX_PINS = 10;

export const widgetPlacementSchema = z.object({
    widgetId: z.string().min(1),
    col: z.number().int().min(0).max(GRID_COLS - 1),
    row: z.number().int().min(0).max(GRID_ROWS_MAX - 1),
    colSpan: z.number().int().min(1).max(3),
    rowSpan: z.number().int().min(1).max(3),
});

const workspacePinnedItemSchema = z.object({
    type: z.enum(['task', 'project']),
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    projectSlug: z.string().nullable().optional(),
    projectKey: z.string().nullable().optional(),
    taskNumber: z.number().int().nullable().optional(),
    projectId: z.string().optional(),
});

export const workspaceLayoutSchema = z.object({
    version: z.number().int().min(1),
    widgets: z.array(widgetPlacementSchema).max(20),
    quickNotes: z.object({
        content: z.string().max(50_000),
        updatedAt: z.string().min(1),
    }).optional(),
    pins: z.array(workspacePinnedItemSchema).max(MAX_PINS).optional(),
});

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Check if a widget placement respects the widget's min/max size constraints.
 */
export function isWithinSizeConstraints(placement: WidgetPlacement): boolean {
    const config = WIDGET_REGISTRY[placement.widgetId as keyof typeof WIDGET_REGISTRY];
    if (!config) return false;

    return (
        placement.colSpan >= config.minColSpan &&
        placement.colSpan <= config.maxColSpan &&
        placement.rowSpan >= config.minRowSpan &&
        placement.rowSpan <= config.maxRowSpan
    );
}

/**
 * Check if a placement fits within the grid bounds.
 */
export function isWithinBounds(placement: WidgetPlacement): boolean {
    return (
        placement.col >= 0 &&
        placement.row >= 0 &&
        placement.col + placement.colSpan <= GRID_COLS &&
        placement.row + placement.rowSpan <= GRID_ROWS_MAX
    );
}

/**
 * Check if two widgets overlap.
 */
export function doWidgetsOverlap(a: WidgetPlacement, b: WidgetPlacement): boolean {
    // No overlap if one is entirely to the left/right/above/below the other
    return !(
        a.col + a.colSpan <= b.col ||
        b.col + b.colSpan <= a.col ||
        a.row + a.rowSpan <= b.row ||
        b.row + b.rowSpan <= a.row
    );
}

/**
 * Validate an entire layout: no overlaps, all in bounds, all within size constraints.
 * Returns true if the layout is valid.
 */
export function isValidLayout(layout: WorkspaceLayout): boolean {
    const { widgets } = layout;

    // Check each widget individually
    for (const w of widgets) {
        if (!isWithinBounds(w)) return false;
        if (!isWithinSizeConstraints(w)) return false;
    }

    // Check no duplicates
    const ids = new Set(widgets.map(w => w.widgetId));
    if (ids.size !== widgets.length) return false;

    // Check no overlaps
    for (let i = 0; i < widgets.length; i++) {
        for (let j = i + 1; j < widgets.length; j++) {
            if (doWidgetsOverlap(widgets[i], widgets[j])) return false;
        }
    }

    return true;
}

/**
 * Given a layout from the DB (possibly null, invalid, or old version),
 * return a valid layout. Falls back to DEFAULT_LAYOUT if anything is wrong.
 */
export function resolveLayout(raw: unknown): WorkspaceLayout {
    if (!raw) return DEFAULT_LAYOUT;

    const parsed = workspaceLayoutSchema.safeParse(raw);
    if (!parsed.success) return DEFAULT_LAYOUT;

    const parsedLayout = parsed.data as WorkspaceLayout;
    const seen = new Set<string>();
    const layout: WorkspaceLayout = {
        ...parsedLayout,
        widgets: parsedLayout.widgets
            .map((widget) => ({
                ...widget,
                widgetId: widget.widgetId === 'shortcuts' ? 'quick_actions' : widget.widgetId,
            }))
            .filter((widget) => {
                if (seen.has(widget.widgetId)) return false;
                seen.add(widget.widgetId);
                return true;
            }),
    };
    if (!isValidLayout(layout)) return DEFAULT_LAYOUT;

    const normalizedVersion =
        layout.version < WORKSPACE_LAYOUT_VERSION
            ? WORKSPACE_LAYOUT_VERSION
            : layout.version;

    return {
        ...layout,
        version: normalizedVersion,
        pins: layout.pins?.filter((pin) => pin.type !== 'task' || !!pin.projectId).slice(0, MAX_PINS) ?? [],
        quickNotes: layout.quickNotes && layout.quickNotes.content
            ? {
                content: layout.quickNotes.content,
                updatedAt: layout.quickNotes.updatedAt,
            }
            : undefined,
    };
}
