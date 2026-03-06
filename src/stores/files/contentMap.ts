/**
 * Phase 5 Optimization: Detached Content Map
 * 
 * Purpose: Stores raw file content strings OUTSIDE of Zustand/React state.
 * React's reconciliation engine no longer diffs 10MB text strings on every
 * keystroke. The Zustand store tracks only a lightweight `contentVersion`
 * counter, and components call `getFileContent()` imperatively.
 * 
 * Why a vanilla Map instead of Zustand:
 * - React.memo / useSyncExternalStore run shallow-equality checks on every
 *   subscriber. If a 500KB string lives in the store, that check runs on
 *   EVERY state mutation across the entire workspace.
 * - A plain Map is O(1) get/set with zero framework overhead.
 * 
 * Thread Safety: This runs on the main thread only. Web Workers have their
 * own memory space, so there is no cross-thread contention.
 */

// Composite key: `${projectId}::${nodeId}`
const _contentMap = new Map<string, string>();

/** Build the composite cache key */
export function contentKey(projectId: string, nodeId: string): string {
    return `${projectId}::${nodeId}`;
}

/** Read raw file content from the detached map. Returns "" if not found. */
export function getFileContent(projectId: string, nodeId: string): string {
    return _contentMap.get(contentKey(projectId, nodeId)) ?? "";
}

/** Write raw file content to the detached map. */
export function setFileContent(
    projectId: string,
    nodeId: string,
    content: string
): void {
    _contentMap.set(contentKey(projectId, nodeId), content);
}

/** Delete a single file's content from the detached map. */
export function deleteFileContent(
    projectId: string,
    nodeId: string
): void {
    _contentMap.delete(contentKey(projectId, nodeId));
}

/** Evict all content entries for a given project. */
export function clearProjectContent(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const key of _contentMap.keys()) {
        if (key.startsWith(prefix)) {
            _contentMap.delete(key);
        }
    }
}

/** Current number of cached content entries (for diagnostics). */
export function contentMapSize(): number {
    return _contentMap.size;
}
