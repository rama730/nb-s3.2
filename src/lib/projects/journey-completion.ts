export type JourneyCompletionDates = Record<string, string>;

const JOURNEY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    // Completion timestamps are persisted as UTC instants. An explicit zone
    // keeps the calendar date stable across browsers, SSR, and collaborators.
    timeZone: 'UTC',
});

export function normalizeJourneyCompletionTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function formatJourneyCompletionDate(value: unknown): string | null {
    const timestamp = normalizeJourneyCompletionTimestamp(value);
    return timestamp ? JOURNEY_DATE_FORMATTER.format(new Date(timestamp)) : null;
}

/**
 * Only a recorded per-stage timestamp can claim a completion date. Legacy
 * projects may have completed stages without history; unrelated project edits
 * must never be presented as journey events.
 */
export function getStageCompletionTooltip(value?: string) {
    const completedAt = formatJourneyCompletionDate(value);
    return completedAt ? `Finished on ${completedAt}` : 'Finished — date not recorded';
}

export function normalizeJourneyCompletionDates(
    value: unknown,
    completedStageCount: number,
): JourneyCompletionDates {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const safeCompletedStageCount = Math.max(0, Math.trunc(completedStageCount));
    const normalized: JourneyCompletionDates = {};

    for (const [key, rawTimestamp] of Object.entries(value as Record<string, unknown>)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= safeCompletedStageCount) continue;
        const timestamp = normalizeJourneyCompletionTimestamp(rawTimestamp);
        if (timestamp) normalized[String(index)] = timestamp;
    }

    return normalized;
}

/**
 * Computes the complete timestamp record for one lifecycle transition.
 * Existing authoritative timestamps are retained, forward transitions stamp
 * every newly crossed stage once, and regressions discard reopened stages.
 * Missing legacy history remains missing rather than being fabricated.
 */
export function buildJourneyCompletionDates(input: {
    completionDates: unknown;
    previousStageIndex: number;
    nextStageIndex: number;
    transitionedAt: string;
}): JourneyCompletionDates {
    const previousStageIndex = Math.max(0, Math.trunc(input.previousStageIndex));
    const nextStageIndex = Math.max(0, Math.trunc(input.nextStageIndex));
    const completionDates = normalizeJourneyCompletionDates(input.completionDates, nextStageIndex);
    const transitionedAt = normalizeJourneyCompletionTimestamp(input.transitionedAt);
    if (!transitionedAt) throw new Error('Invalid journey transition timestamp');

    for (let index = previousStageIndex; index < nextStageIndex; index += 1) {
        const key = String(index);
        if (!completionDates[key]) completionDates[key] = transitionedAt;
    }

    return completionDates;
}
