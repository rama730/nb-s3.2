import { recordOtlpMetric } from '@/lib/telemetry/otlp'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
    module?: string
    userId?: string
    requestId?: string
    sampleRate?: number
    [key: string]: unknown
}

const REDACT_KEY_PATTERN = /password|token|secret|authorization/i
const ALLOWED_CONTEXT_KEY_PATTERN = /^(module|userId|viewerUserId|subjectUserId|targetUserId|actorUserId|requestId|sampleRate|route|action|status|success|errorCode|error|reason|failureReason|eventType|event|type|kind|scope|conversationId|projectId|taskId|nodeId|attachmentId|sessionId|uploadIntentId|deliveryId|durationMs|count|remainingCount|sizeBytes|generatedCount|requestedCount|available|blocked|canViewProfile|visibilityReason|connectionState|currentPercent|targetPercent|runId|metric|normalizedUsername|bucket|storageKey|contentType|limit|offset|cursor|attempt|allowed|routePath|path|code|routeId|subjectCount|viewerCount|finalized|removedObjects|expiredIntents|nextCursor|hasMore|version|createdAt|updatedAt|finalizedAt|redeemedAt|expiresAt|remaining|statusCode|method|_type)$/;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function isVerboseConsoleLoggingEnabled() {
    return process.env.NODE_ENV !== 'production'
        && (process.env.NEXT_PUBLIC_VERBOSE_APP_LOGS === '1' || process.env.VERBOSE_APP_LOGS === '1')
}

function shouldLog(level: LogLevel): boolean {
    const minLevel: LogLevel = isVerboseConsoleLoggingEnabled() ? 'debug' : 'warn'
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

function shouldSample(level: LogLevel, message: string, context?: LogContext): boolean {
    if (level === 'warn' || level === 'error') return true

    const sampleRate = typeof context?.sampleRate === 'number'
        ? Math.max(0, Math.min(1, context.sampleRate))
        : 1
    if (sampleRate >= 1) return true
    if (sampleRate <= 0) return false

    // Use deterministic sampling only when requestId is present (consistent per-request)
    if (context?.requestId) {
        const seed = String(context.requestId)
        let hash = 0
        for (let index = 0; index < seed.length; index += 1) {
            hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
        }
        return (hash % 10_000) / 10_000 < sampleRate
    }
    // Non-deterministic sampling for general logs
    return Math.random() < sampleRate
}

function emit(level: LogLevel, message: string, context?: LogContext) {
    if (!shouldLog(level)) return
    if (!shouldSample(level, message, context)) return

    const { sampleRate: _sampleRate, ...safeContext } = sanitizeContext(context || {})
    const entry = { level, msg: message, ts: Date.now(), ...safeContext }
    const verboseConsoleLogs = isVerboseConsoleLoggingEnabled()

    switch (level) {
        case 'error':
            console.error("[logger]", entry)
            break
        case 'warn':
            console.warn("[logger]", entry)
            break
        case 'debug':
            if (verboseConsoleLogs) {
                console.debug("[logger]", entry)
            }
            break
        default:
            if (verboseConsoleLogs) {
                console.info("[logger]", entry)
            }
            break
    }
}

function sanitizeValue(key: string, value: unknown): unknown {
    if (REDACT_KEY_PATTERN.test(key)) return '[REDACTED]'
    if (typeof value === 'string') {
        if (REDACT_KEY_PATTERN.test(value)) return '[REDACTED]'
        return value.length > 500 ? `${value.slice(0, 497)}...` : value
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => sanitizeValue(key, item))
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([childKey]) => ALLOWED_CONTEXT_KEY_PATTERN.test(childKey) && !REDACT_KEY_PATTERN.test(childKey))
            .map(([childKey, childValue]) => [childKey, sanitizeValue(childKey, childValue)])
        return Object.fromEntries(entries)
    }
    return value
}

function sanitizeContext(context: LogContext): LogContext {
    const sanitizedEntries = Object.entries(context)
        .filter(([key]) => ALLOWED_CONTEXT_KEY_PATTERN.test(key) && !REDACT_KEY_PATTERN.test(key))
        .map(([key, value]) => [key, sanitizeValue(key, value)])
    return Object.fromEntries(sanitizedEntries)
}

export const logger = {
    debug: (message: string, context?: LogContext) => emit('debug', message, context),
    info:  (message: string, context?: LogContext) => emit('info', message, context),
    warn:  (message: string, context?: LogContext) => emit('warn', message, context),
    error: (message: string, context?: LogContext) => emit('error', message, context),
    metric: (metric: string, payload: Record<string, unknown>) => {
        recordOtlpMetric(metric, payload)
        emit('info', metric, { ...payload, _type: 'metric' })
    },
}
