import type {
    NotificationDeliveryPreferences,
    NotificationMuteScope,
    NotificationMuteScopeKind,
    NotificationPreferenceCategory,
    NotificationPreferences,
    NotificationQuietHours,
} from "@/lib/notifications/types";

const DEFAULT_QUIET_HOURS: NotificationQuietHours = {
    enabled: false,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
};

const DEFAULT_DELIVERY: NotificationDeliveryPreferences = {
    browser: false,
    push: false,
    emailDigest: true,
};

function normalizeDelivery(value: unknown): NotificationDeliveryPreferences {
    if (!value || typeof value !== "object") return { ...DEFAULT_DELIVERY };
    const candidate = value as Partial<Record<keyof NotificationDeliveryPreferences, unknown>>;
    return {
        browser: typeof candidate.browser === "boolean" ? candidate.browser : DEFAULT_DELIVERY.browser,
        push: typeof candidate.push === "boolean" ? candidate.push : DEFAULT_DELIVERY.push,
        emailDigest: typeof candidate.emailDigest === "boolean" ? candidate.emailDigest : DEFAULT_DELIVERY.emailDigest,
    };
}

function clampMinute(value: unknown, fallback: number): number {
    const num = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : Number.NaN;
    if (Number.isNaN(num)) return fallback;
    if (num < 0) return 0;
    if (num > 1439) return 1439;
    return num;
}

function normalizeQuietHours(value: unknown): NotificationQuietHours {
    if (!value || typeof value !== "object") return { ...DEFAULT_QUIET_HOURS };
    const candidate = value as Partial<Record<keyof NotificationQuietHours, unknown>>;
    return {
        enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_QUIET_HOURS.enabled,
        startMinute: clampMinute(candidate.startMinute, DEFAULT_QUIET_HOURS.startMinute),
        endMinute: clampMinute(candidate.endMinute, DEFAULT_QUIET_HOURS.endMinute),
    };
}

export const NOTIFICATION_PREFERENCE_CATEGORIES = [
    "messages",
    "mentions",
    "workflows",
    "projects",
    "tasks",
    "applications",
    "connections",
] as const satisfies NotificationPreferenceCategory[];

const NOTIFICATION_MUTE_SCOPE_KINDS = [
    "notification_type",
    "project",
    "task",
    "conversation",
    "person",
] as const satisfies readonly NotificationMuteScopeKind[];

const NOTIFICATION_MUTE_SCOPE_KIND_SET = new Set<NotificationMuteScopeKind>(NOTIFICATION_MUTE_SCOPE_KINDS);

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    messages: true,
    mentions: true,
    workflows: true,
    projects: true,
    tasks: true,
    applications: true,
    connections: true,
    pausedUntil: null,
    mutedScopes: [],
    quietHours: { ...DEFAULT_QUIET_HOURS },
    delivery: { ...DEFAULT_DELIVERY },
};

function asBoolean(value: unknown, fallback: boolean) {
    return typeof value === "boolean" ? value : fallback;
}

function asIsoDate(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMuteScopeKind(value: unknown): NotificationMuteScopeKind | null {
    if (value === "kind") return "notification_type";
    if (
        typeof value === "string"
        && NOTIFICATION_MUTE_SCOPE_KIND_SET.has(value as NotificationMuteScopeKind)
    ) {
        return value as NotificationMuteScopeKind;
    }
    return null;
}

function normalizeMuteScope(value: unknown): NotificationMuteScope | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<Record<keyof NotificationMuteScope, unknown>>;
    const kind = normalizeMuteScopeKind(candidate.kind);
    const valueKey = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!kind || !valueKey) return null;
    return {
        kind,
        value: valueKey,
        label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim().slice(0, 120) : null,
        mutedAt: asIsoDate(candidate.mutedAt),
    };
}

function normalizeMuteScopes(value: unknown): NotificationMuteScope[] {
    if (!Array.isArray(value)) return [];
    const unique = new Map<string, NotificationMuteScope>();
    for (const raw of value) {
        const scope = normalizeMuteScope(raw);
        if (!scope) continue;
        unique.set(`${scope.kind}:${scope.value}`, scope);
    }
    return Array.from(unique.values()).slice(0, 100);
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    const candidate = value as Partial<Record<keyof NotificationPreferences, unknown>>;
    return {
        messages: asBoolean(candidate.messages, DEFAULT_NOTIFICATION_PREFERENCES.messages),
        mentions: asBoolean(candidate.mentions, DEFAULT_NOTIFICATION_PREFERENCES.mentions),
        workflows: asBoolean(candidate.workflows, DEFAULT_NOTIFICATION_PREFERENCES.workflows),
        projects: asBoolean(candidate.projects, DEFAULT_NOTIFICATION_PREFERENCES.projects),
        tasks: asBoolean(candidate.tasks, DEFAULT_NOTIFICATION_PREFERENCES.tasks),
        applications: asBoolean(candidate.applications, DEFAULT_NOTIFICATION_PREFERENCES.applications),
        connections: asBoolean(candidate.connections, DEFAULT_NOTIFICATION_PREFERENCES.connections),
        pausedUntil: asIsoDate(candidate.pausedUntil),
        mutedScopes: normalizeMuteScopes(candidate.mutedScopes),
        quietHours: normalizeQuietHours(candidate.quietHours),
        delivery: normalizeDelivery(candidate.delivery),
    };
}

export function isNotificationPauseActive(preferences: NotificationPreferences, now: Date = new Date()) {
    if (!preferences.pausedUntil) return false;
    const pausedUntil = new Date(preferences.pausedUntil);
    return !Number.isNaN(pausedUntil.getTime()) && pausedUntil.getTime() > now.getTime();
}

export function getNotificationPauseUntil(preferences: NotificationPreferences, now: Date = new Date()): Date | null {
    if (!isNotificationPauseActive(preferences, now) || !preferences.pausedUntil) return null;
    const pausedUntil = new Date(preferences.pausedUntil);
    return Number.isNaN(pausedUntil.getTime()) ? null : pausedUntil;
}

export function isQuietHoursActive(preferences: NotificationPreferences, now: Date = new Date()) {
    const { enabled, startMinute, endMinute } = preferences.quietHours;
    if (!enabled) return false;
    if (startMinute === endMinute) return false;
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (startMinute < endMinute) {
        return minuteOfDay >= startMinute && minuteOfDay < endMinute;
    }
    return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

export function getQuietHoursResumeAt(preferences: NotificationPreferences, now: Date = new Date()): Date | null {
    if (!isQuietHoursActive(preferences, now)) return null;
    const { startMinute, endMinute } = preferences.quietHours;
    const resume = new Date(now);
    resume.setHours(Math.floor(endMinute / 60), endMinute % 60, 0, 0);

    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (startMinute > endMinute && minuteOfDay >= startMinute) {
        resume.setDate(resume.getDate() + 1);
    }
    if (resume.getTime() <= now.getTime()) {
        resume.setDate(resume.getDate() + 1);
    }
    return resume;
}

export function formatMinuteOfDay(minute: number): string {
    const safe = Math.min(1439, Math.max(0, Math.floor(minute)));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function parseTimeInput(value: string): number | null {
    const match = value.trim().match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}
