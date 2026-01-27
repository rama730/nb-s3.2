// Simple logger utility

export const logger = {
    info: (message: string, data?: Record<string, unknown>) => {
        console.log(`[INFO] ${message}`, data || '');
    },
    warn: (message: string, data?: Record<string, unknown>) => {
        console.warn(`[WARN] ${message}`, data || '');
    },
    error: (message: string, data?: Record<string, unknown>) => {
        console.error(`[ERROR] ${message}`, data || '');
    },
    debug: (message: string, data?: Record<string, unknown>) => {
        if (process.env.NODE_ENV === 'development') {
            console.debug(`[DEBUG] ${message}`, data || '');
        }
    },
};
