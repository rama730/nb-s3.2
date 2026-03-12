type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
    module?: string
    userId?: string
    requestId?: string
    [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const MIN_LEVEL: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function emit(level: LogLevel, message: string, context?: LogContext) {
    if (!shouldLog(level)) return

    const entry = { level, msg: message, ts: Date.now(), ...context }

    if (IS_PRODUCTION) {
        switch (level) {
            case 'error': console.error("[logger]", entry); break
            case 'warn':  console.warn("[logger]", entry); break
            default:      console.info("[logger]", entry); break
        }
    } else {
        switch (level) {
            case 'error': console.error("[logger]", entry); break
            case 'warn':  console.warn("[logger]", entry); break
            case 'debug': console.debug("[logger]", entry); break
            default:      console.info("[logger]", entry); break
        }
    }
}

export const logger = {
    debug: (message: string, context?: LogContext) => emit('debug', message, context),
    info:  (message: string, context?: LogContext) => emit('info', message, context),
    warn:  (message: string, context?: LogContext) => emit('warn', message, context),
    error: (message: string, context?: LogContext) => emit('error', message, context),
    metric: (metric: string, payload: Record<string, unknown>) => {
        emit('info', metric, { ...payload, _type: 'metric' })
    },
}
