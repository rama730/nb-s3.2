import type { WidgetPlacement, WidgetCardSizeMode } from './types';

/**
 * Pure function: placement -> size mode. No side effects, no deps.
 * Refined thresholds for clearer boundaries:
 * - compact: area <= 2 (1x1, 2x1, 1x2)
 * - standard: area 3-4 (2x2, 3x1, 1x3)
 * - expanded: area >= 5
 */
export function getWidgetCardSizeMode(placement: WidgetPlacement): WidgetCardSizeMode {
    const area = placement.colSpan * placement.rowSpan;
    if (area <= 2) return 'compact';
    if (area >= 5) return 'expanded';
    return 'standard';
}
