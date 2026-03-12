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

function sortWidgetsStable(widgets: WidgetPlacement[]): WidgetPlacement[] {
    return [...widgets].sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        if (a.col !== b.col) return a.col - b.col;
        return a.widgetId.localeCompare(b.widgetId);
    });
}

function overlapsAny(placement: WidgetPlacement, widgets: WidgetPlacement[]): boolean {
    return widgets.some((widget) => doWidgetsOverlap(widget, placement));
}

/**
 * Deterministic layout resolution:
 * 1) keep the mutated widget anchored at its requested position
 * 2) compact all other widgets upward where possible
 * 3) validate bounds/constraints atomically
 */
function resolveLayoutWithCompaction(
    widgets: WidgetPlacement[],
    anchorWidgetId: string
): WidgetPlacement[] | null {
    const cloned = widgets.map((widget) => ({ ...widget }));
    const anchor = cloned.find((widget) => widget.widgetId === anchorWidgetId);
    if (!anchor) return null;
    if (!isWithinBounds(anchor) || !isWithinSizeConstraints(anchor)) return null;

    const placed: WidgetPlacement[] = [anchor];
    const others = sortWidgetsStable(cloned.filter((widget) => widget.widgetId !== anchorWidgetId));

    for (const original of others) {
        if (!isWithinSizeConstraints(original)) return null;
        let candidate = { ...original };

        // Compact upward first
        while (candidate.row > 0) {
            const upward = { ...candidate, row: candidate.row - 1 };
            if (!isWithinBounds(upward) || overlapsAny(upward, placed)) break;
            candidate = upward;
        }

        // If still overlapping, push downward until we find a valid slot
        while (overlapsAny(candidate, placed)) {
            candidate = { ...candidate, row: candidate.row + 1 };
            if (!isWithinBounds(candidate)) return null;
        }

        placed.push(candidate);
    }

    return sortWidgetsStable(placed);
}

function replaceWidget(
    layout: WorkspaceLayout,
    widgetId: string,
    replacement: WidgetPlacement
): WorkspaceLayout | null {
    const rest = layout.widgets.filter((widget) => widget.widgetId !== widgetId);
    const resolved = resolveLayoutWithCompaction([replacement, ...rest], widgetId);
    if (!resolved) return null;
    if (resolved.some((widget) => !isWithinBounds(widget) || !isWithinSizeConstraints(widget))) return null;
    return { ...layout, widgets: resolved };
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

    const resolved = resolveLayoutWithCompaction([...layout.widgets, newWidget], widgetId);
    if (!resolved) return null;
    return { ...layout, widgets: resolved };
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

    return replaceWidget(layout, widgetId, newWidget);
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

    return replaceWidget(layout, widgetId, movedWidget);
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
