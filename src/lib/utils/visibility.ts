/**
 * Creates an interval that only runs when the page is visible.
 * Pauses when tab is hidden, resumes when visible.
 */
export type VisibilityAwareIntervalController = (() => void) & {
    start: () => void
    stop: () => void
}

export function createVisibilityAwareInterval(
    callback: () => void,
    intervalMs: number,
): VisibilityAwareIntervalController {
    let timerId: ReturnType<typeof setInterval> | null = null;
    let enabled = true;

    function startTimer() {
        if (timerId !== null) return;
        timerId = setInterval(callback, intervalMs);
    }

    function stopTimer() {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function start() {
        enabled = true;
        if (typeof document !== 'undefined' && document.hidden) return;
        startTimer();
    }

    function stop() {
        enabled = false;
        stopTimer();
    }

    function onVisibilityChange() {
        if (document.hidden) {
            stopTimer();
        } else {
            if (!enabled) return;
            callback();
            startTimer();
        }
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
        if (!document.hidden) startTimer();
    }

    const cleanup = (() => {
        stopTimer();
        enabled = false;
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
    }) as VisibilityAwareIntervalController;

    cleanup.start = start;
    cleanup.stop = stop;

    return cleanup;
}
