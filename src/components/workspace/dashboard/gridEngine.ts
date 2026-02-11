import { GRID_COLS, GRID_ROWS_MAX } from './types';
import type { WorkspaceLayout, WidgetPlacement } from './types';
import { WIDGET_REGISTRY } from './widgetRegistry';
import { doWidgetsOverlap, isWithinBounds, isWithinSizeConstraints } from './validation';

// ============================================================================
// Grid Engine — Pure functions for grid math, no React, no side effects
// ============================================================================

/**
 * Returns a Set of occupied cell keys ("col:row") for fast lookup.
 */
export function getOccupiedCells(widgets: WidgetPlacement[]): Set<string> {
    const cells = new Set<string>();
    for (const w of widgets) {
        for (let c = w.col; c < w.col + w.colSpan; c++) {
            for (let r = w.row; r < w.row + w.rowSpan; r++) {
                cells.add(`${c}:${r}`);
            }
        }
    }
    return cells;
}

/**
 * Check if a cell at (col, row) is occupied by any widget.
 */
export function isCellOccupied(widgets: WidgetPlacement[], col: number, row: number): boolean {
    for (const w of widgets) {
        if (
            col >= w.col && col < w.col + w.colSpan &&
            row >= w.row && row < w.row + w.rowSpan
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Get the widget at a specific cell position, or null.
 */
export function getWidgetAtCell(widgets: WidgetPlacement[], col: number, row: number): WidgetPlacement | null {
    for (const w of widgets) {
        if (
            col >= w.col && col < w.col + w.colSpan &&
            row >= w.row && row < w.row + w.rowSpan
        ) {
            return w;
        }
    }
    return null;
}

/**
 * Resolve collisions by pushing overlapping widgets downward.
 * This is a simple, predictable strategy (same as Grafana/GridStack).
 * Returns the new widgets array with resolved positions.
 */
function resolveCollisions(
    widgets: WidgetPlacement[],
    movedWidgetId: string
): WidgetPlacement[] {
    const result = [...widgets.map(w => ({ ...w }))];
    const movedWidget = result.find(w => w.widgetId === movedWidgetId);
    if (!movedWidget) return result;

    // Keep pushing colliding widgets down until no overlaps remain
    // Max iterations = widget count * GRID_ROWS_MAX to prevent infinite loops
    const maxIterations = result.length * GRID_ROWS_MAX;
    let iteration = 0;

    let hasCollision = true;
    while (hasCollision && iteration < maxIterations) {
        hasCollision = false;
        iteration++;

        for (const other of result) {
            if (other.widgetId === movedWidgetId) continue;
            if (doWidgetsOverlap(movedWidget, other)) {
                // Push the other widget below the moved widget
                other.row = movedWidget.row + movedWidget.rowSpan;
                hasCollision = true;

                // Now recursively check if this pushed widget collides with others
                for (const another of result) {
                    if (another.widgetId === other.widgetId) continue;
                    if (another.widgetId === movedWidgetId) continue;
                    if (doWidgetsOverlap(other, another)) {
                        another.row = other.row + other.rowSpan;
                    }
                }
            }
        }
    }

    return result;
}

/**
 * Place a new widget at (col, row). Returns the new layout or null if invalid.
 */
export function placeWidget(
    layout: WorkspaceLayout,
    widgetId: string,
    col: number,
    row: number
): WorkspaceLayout | null {
    // Check not already placed
    if (layout.widgets.some(w => w.widgetId === widgetId)) return null;

    const config = WIDGET_REGISTRY[widgetId as keyof typeof WIDGET_REGISTRY];
    if (!config) return null;

    const newWidget: WidgetPlacement = {
        widgetId,
        col,
        row,
        colSpan: config.minColSpan,
        rowSpan: config.minRowSpan,
    };

    if (!isWithinBounds(newWidget)) return null;

    // Resolve collisions with existing widgets
    const newWidgets = resolveCollisions([...layout.widgets, newWidget], widgetId);

    // Validate all are still in bounds
    if (newWidgets.some(w => !isWithinBounds(w))) return null;

    return { ...layout, widgets: newWidgets };
}

/**
 * Remove a widget from the layout. No reflow — empty space remains.
 */
export function removeWidget(
    layout: WorkspaceLayout,
    widgetId: string
): WorkspaceLayout {
    return {
        ...layout,
        widgets: layout.widgets.filter(w => w.widgetId !== widgetId),
    };
}

/**
 * Resize a widget. Returns the new layout or null if the resize is invalid.
 */
export function resizeWidget(
    layout: WorkspaceLayout,
    widgetId: string,
    newColSpan: number,
    newRowSpan: number
): WorkspaceLayout | null {
    const widgetIndex = layout.widgets.findIndex(w => w.widgetId === widgetId);
    if (widgetIndex === -1) return null;

    const widget = layout.widgets[widgetIndex];
    const newWidget: WidgetPlacement = {
        ...widget,
        colSpan: newColSpan,
        rowSpan: newRowSpan,
    };

    if (!isWithinBounds(newWidget)) return null;
    if (!isWithinSizeConstraints(newWidget)) return null;

    // Replace the widget and resolve collisions
    const otherWidgets = layout.widgets.filter(w => w.widgetId !== widgetId);
    const newWidgets = resolveCollisions([newWidget, ...otherWidgets], widgetId);

    if (newWidgets.some(w => !isWithinBounds(w))) return null;

    return { ...layout, widgets: newWidgets };
}

/**
 * Move a widget to a new position. Returns the new layout or null if invalid.
 */
export function moveWidget(
    layout: WorkspaceLayout,
    widgetId: string,
    newCol: number,
    newRow: number
): WorkspaceLayout | null {
    const widgetIndex = layout.widgets.findIndex(w => w.widgetId === widgetId);
    if (widgetIndex === -1) return null;

    const widget = layout.widgets[widgetIndex];
    const movedWidget: WidgetPlacement = {
        ...widget,
        col: newCol,
        row: newRow,
    };

    if (!isWithinBounds(movedWidget)) return null;

    // Replace the widget and resolve collisions
    const otherWidgets = layout.widgets.filter(w => w.widgetId !== widgetId);
    const newWidgets = resolveCollisions([movedWidget, ...otherWidgets], widgetId);

    if (newWidgets.some(w => !isWithinBounds(w))) return null;

    return { ...layout, widgets: newWidgets };
}

/**
 * Calculate the actual row count used by the current layout.
 */
export function getMaxRow(widgets: WidgetPlacement[]): number {
    if (widgets.length === 0) return 0;
    return Math.max(...widgets.map(w => w.row + w.rowSpan));
}

/**
 * Find the first empty cell position that fits a widget of given min size.
 * Scans left-to-right, top-to-bottom.
 */
export function findFirstEmptyPosition(
    widgets: WidgetPlacement[],
    minColSpan: number,
    minRowSpan: number
): { col: number; row: number } | null {
    const occupied = getOccupiedCells(widgets);

    for (let r = 0; r < GRID_ROWS_MAX; r++) {
        for (let c = 0; c <= GRID_COLS - minColSpan; c++) {
            let fits = true;
            for (let dc = 0; dc < minColSpan && fits; dc++) {
                for (let dr = 0; dr < minRowSpan && fits; dr++) {
                    if (occupied.has(`${c + dc}:${r + dr}`)) {
                        fits = false;
                    }
                }
            }
            if (fits && c + minColSpan <= GRID_COLS && r + minRowSpan <= GRID_ROWS_MAX) {
                return { col: c, row: r };
            }
        }
    }

    return null;
}

/**
 * Snap a pixel-based drag position to the nearest grid cell.
 */
export function snapToGrid(
    x: number,
    y: number,
    cellWidth: number,
    cellHeight: number
): { col: number; row: number } {
    const col = Math.max(0, Math.min(GRID_COLS - 1, Math.round(x / cellWidth)));
    const row = Math.max(0, Math.round(y / cellHeight));
    return { col, row };
}
