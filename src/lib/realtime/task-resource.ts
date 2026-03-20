import type { RealtimeChannel } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'
import { subscribeActiveResource, type DbRealtimePayload } from '@/lib/realtime/subscriptions'

export type TaskResourceEvent =
    | { kind: 'comment'; payload: DbRealtimePayload }
    | { kind: 'subtask'; payload: DbRealtimePayload }
    | { kind: 'attachment_link'; payload: DbRealtimePayload }

type TaskResourceListener = (event: TaskResourceEvent) => void
type TaskResourceStatusListener = (status: string) => void

type TaskResourceEntry = {
    taskId: string
    channel: RealtimeChannel | null
    listeners: Set<TaskResourceListener>
    statusListeners: Set<TaskResourceStatusListener>
    reconnectAttempts: number
    reconnectTimer: ReturnType<typeof setTimeout> | null
}

const taskResourceEntries = new Map<string, TaskResourceEntry>()

function notifyStatus(entry: TaskResourceEntry, status: string) {
    for (const listener of entry.statusListeners) {
        listener(status)
    }
}

function cleanupEntry(taskId: string) {
    const entry = taskResourceEntries.get(taskId)
    if (!entry) return

    if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer)
        entry.reconnectTimer = null
    }

    if (entry.channel) {
        const supabase = createClient()
        void supabase.removeChannel(entry.channel)
        entry.channel = null
    }

    taskResourceEntries.delete(taskId)
}

function scheduleReconnect(entry: TaskResourceEntry) {
    if (entry.reconnectTimer || entry.listeners.size === 0) return

    const delayMs = Math.min(10_000, 800 * Math.max(1, entry.reconnectAttempts + 1))
    entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null
        if (entry.listeners.size === 0) {
            cleanupEntry(entry.taskId)
            return
        }
        entry.reconnectAttempts += 1
        openTaskResource(entry)
    }, delayMs)
}

function openTaskResource(entry: TaskResourceEntry) {
    if (entry.channel) {
        const supabase = createClient()
        void supabase.removeChannel(entry.channel)
        entry.channel = null
    }

    const supabase = createClient()
    entry.channel = subscribeActiveResource({
        supabase,
        resourceType: 'task',
        resourceId: `${entry.taskId}:${entry.reconnectAttempts}`,
        bindings: [
            {
                event: '*',
                table: 'task_comments',
                filter: `task_id=eq.${entry.taskId}`,
                handler: (payload) => {
                    for (const listener of entry.listeners) {
                        listener({ kind: 'comment', payload })
                    }
                },
            },
            {
                event: '*',
                table: 'task_subtasks',
                filter: `task_id=eq.${entry.taskId}`,
                handler: (payload) => {
                    for (const listener of entry.listeners) {
                        listener({ kind: 'subtask', payload })
                    }
                },
            },
            {
                event: '*',
                table: 'task_node_links',
                filter: `task_id=eq.${entry.taskId}`,
                handler: (payload) => {
                    for (const listener of entry.listeners) {
                        listener({ kind: 'attachment_link', payload })
                    }
                },
            },
        ],
        onStatus: (status) => {
            notifyStatus(entry, status)
            if (status === 'SUBSCRIBED') {
                entry.reconnectAttempts = 0
                return
            }

            if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                scheduleReconnect(entry)
            }
        },
    })
}

function ensureTaskEntry(taskId: string) {
    const existing = taskResourceEntries.get(taskId)
    if (existing) return existing

    const entry: TaskResourceEntry = {
        taskId,
        channel: null,
        listeners: new Set(),
        statusListeners: new Set(),
        reconnectAttempts: 0,
        reconnectTimer: null,
    }
    taskResourceEntries.set(taskId, entry)
    openTaskResource(entry)
    return entry
}

export function subscribeTaskResource(params: {
    taskId: string
    onEvent: TaskResourceListener
    onStatus?: TaskResourceStatusListener
}) {
    const entry = ensureTaskEntry(params.taskId)
    entry.listeners.add(params.onEvent)
    if (params.onStatus) {
        entry.statusListeners.add(params.onStatus)
    }

    return () => {
        entry.listeners.delete(params.onEvent)
        if (params.onStatus) {
            entry.statusListeners.delete(params.onStatus)
        }

        if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
            cleanupEntry(params.taskId)
        }
    }
}

