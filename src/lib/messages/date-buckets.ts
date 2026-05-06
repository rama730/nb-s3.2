export interface MessageCalendarDay {
    key: string;
    date: Date;
}

function getTimeZone(timeZone?: string | null): string | undefined {
    if (timeZone) return timeZone;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

function getCalendarParts(value: Date | string, timeZone?: string | null) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: getTimeZone(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    if (!year || !month || !day) return null;
    return { year, month, day };
}

function calendarKey(parts: { year: number; month: number; day: number }) {
    return [
        String(parts.year).padStart(4, '0'),
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
    ].join('-');
}

function dateFromCalendarKey(key: string): Date {
    const [year, month, day] = key.split('-').map((part) => Number(part));
    if (!year || !month || !day) return new Date(0);
    return new Date(year, month - 1, day);
}

export function getMessageCalendarDay(
    value: Date | string,
    timeZone?: string | null,
): MessageCalendarDay {
    const parts = getCalendarParts(value, timeZone);
    if (!parts) {
        return {
            key: 'unknown',
            date: new Date(0),
        };
    }

    const key = calendarKey(parts);
    return {
        key,
        date: dateFromCalendarKey(key),
    };
}

export function formatMessageCalendarLabel(
    key: string,
    options: { now?: Date | string; timeZone?: string | null } = {},
): string {
    if (key === 'unknown') return 'Unknown date';

    const today = getMessageCalendarDay(options.now ?? new Date(), options.timeZone);
    const yesterdayDate = today.date;
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getMessageCalendarDay(yesterdayDate, options.timeZone);

    if (key === today.key) return 'Today';
    if (key === yesterday.key) return 'Yesterday';

    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: getTimeZone(options.timeZone),
    }).format(dateFromCalendarKey(key));
}
