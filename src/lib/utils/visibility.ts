/**
 * Creates an interval that only runs when the page is visible.
 * Pauses when tab is hidden, resumes when visible.
 */
export function createVisibilityAwareInterval(
    callback: () => void,
    intervalMs: number,
): () => void {
    let timerId: ReturnType<typeof setInterval> | null = null;

    function start() {
        if (timerId !== null) return;
        timerId = setInterval(callback, intervalMs);
    }

    function stop() {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function onVisibilityChange() {
        if (document.hidden) {
            stop();
        } else {
            callback();
            start();
        }
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
        if (!document.hidden) start();
    }

    return () => {
        stop();
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
    };
}
