const OFFLINE_QUEUE_PREFIX = 'files-offline-queue:'

export type OfflineQueueEntry = {
  content: string
  ts: number
}

function queueKey(projectId: string) {
  return `${OFFLINE_QUEUE_PREFIX}${projectId}`
}

export function readOfflineQueue(projectId: string): Record<string, OfflineQueueEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(queueKey(projectId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, OfflineQueueEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeOfflineQueue(projectId: string, queue: Record<string, OfflineQueueEntry>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(queueKey(projectId), JSON.stringify(queue))
  } catch {
    // keep queue best-effort
  }
}

export function queueOfflineChange(projectId: string, nodeId: string, content: string) {
  const queue = readOfflineQueue(projectId)
  queue[nodeId] = { content, ts: Date.now() }
  writeOfflineQueue(projectId, queue)
}

export function clearOfflineChange(projectId: string, nodeId: string) {
  const queue = readOfflineQueue(projectId)
  if (!(nodeId in queue)) return
  delete queue[nodeId]
  writeOfflineQueue(projectId, queue)
}

export function listOfflineChanges(projectId: string) {
  return Object.entries(readOfflineQueue(projectId))
}
