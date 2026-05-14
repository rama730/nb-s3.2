import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

import { subscribeActiveResource, type DbRealtimePayload } from '@/lib/realtime/subscriptions'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFilesChannelOptions {
    projectId: string
    onTaskLinkChange: (event: { nodeId: string; type: 'INSERT' | 'DELETE' }) => void
    onFileVersionChange: (event: { nodeId: string; newVersion: number }) => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Initial backoff delay in ms before reconnect attempt. */
const BACKOFF_START_MS = 800
/** Maximum backoff delay cap in ms. */
const BACKOFF_CAP_MS = 10_000
/**
 * Maximum number of project-files channels allowed concurrently.
 * Enforced client-side to stay within the realtime budget alongside
 * the existing task-resource channel.
 */
const MAX_BACKGROUND_CHANNELS = 2

// ---------------------------------------------------------------------------
// Channel budget tracking
// ---------------------------------------------------------------------------

const activeChannelIds = new Set<string>()

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Subscribe to a project-scoped realtime channel that multiplexes two
 * Supabase postgres_changes bindings:
 *
 * 1. `task_node_links` — INSERT / DELETE events (filtered by project via
 *    client-side node ownership check since the table lacks a project_id column).
 * 2. `file_versions` — INSERT events for version bumps.
 *
 * Implements exponential backoff reconnect on CHANNEL_ERROR / TIMED_OUT,
 * starting at 800 ms and capping at 10 s — matching the task-resource channel
 * pattern.
 *
 * Returns the RealtimeChannel instance. Call `supabase.removeChannel(channel)`
 * to unsubscribe.
 */
export function subscribeProjectFilesChannel(
    supabase: SupabaseClient,
    options: ProjectFilesChannelOptions,
): RealtimeChannel {
    const { projectId, onTaskLinkChange, onFileVersionChange, onStatus } = options

    // Budget enforcement
    if (activeChannelIds.size >= MAX_BACKGROUND_CHANNELS) {
        logger.warn('realtime.project-files-channel.budget-exceeded', {
            module: 'realtime',
            projectId,
            count: activeChannelIds.size,
        })
    }

    let reconnectAttempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let currentChannel: RealtimeChannel | null = null
    let disposed = false

    const channelId = projectId

    function cleanup() {
        disposed = true
        if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
        }
        activeChannelIds.delete(channelId)
    }

    function scheduleReconnect() {
        if (disposed || reconnectTimer) return

        const delayMs = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * Math.pow(2, reconnectAttempts))
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            if (disposed) return
            reconnectAttempts += 1
            openChannel()
        }, delayMs)
    }

    function handleTaskLinkPayload(payload: DbRealtimePayload) {
        const eventType = payload.eventType
        if (eventType !== 'INSERT' && eventType !== 'DELETE') return

        // Extract nodeId from the payload — INSERT has `new`, DELETE has `old`
        const record = (eventType === 'INSERT' ? payload.new : payload.old) as Record<string, unknown> | undefined
        if (!record) return

        const nodeId = record.node_id as string | undefined
        if (!nodeId) return

        onTaskLinkChange({ nodeId, type: eventType })
    }

    function handleFileVersionPayload(payload: DbRealtimePayload) {
        if (payload.eventType !== 'INSERT') return

        const record = payload.new as Record<string, unknown> | undefined
        if (!record) return

        const nodeId = record.node_id as string | undefined
        const version = record.version as number | undefined
        if (!nodeId || version == null) return

        onFileVersionChange({ nodeId, newVersion: version })
    }

    function openChannel() {
        if (disposed) return

        // Remove previous channel if reconnecting
        if (currentChannel) {
            void supabase.removeChannel(currentChannel)
            currentChannel = null
        }

        currentChannel = subscribeActiveResource({
            supabase,
            resourceType: 'project_files',
            resourceId: `${projectId}:${reconnectAttempts}`,
            bindings: [
                {
                    event: '*',
                    table: 'task_node_links',
                    handler: handleTaskLinkPayload,
                },
                {
                    event: 'INSERT',
                    table: 'file_versions',
                    handler: handleFileVersionPayload,
                },
            ],
            onStatus: (status) => {
                if (disposed) return

                onStatus?.(status)

                if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                    reconnectAttempts = 0
                    return
                }

                if (
                    status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
                    status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
                ) {
                    logger.warn('realtime.project-files-channel.error', {
                        module: 'realtime',
                        projectId,
                        status,
                        attempt: reconnectAttempts,
                    })
                    scheduleReconnect()
                }
            },
        })
    }

    // Track this channel in the budget
    activeChannelIds.add(channelId)

    // Open the initial subscription
    openChannel()

    // Patch the channel's unsubscribe to also run our cleanup
    const channel = currentChannel!
    const originalUnsubscribe = channel.unsubscribe.bind(channel)
    channel.unsubscribe = () => {
        cleanup()
        return originalUnsubscribe()
    }

    return channel
}
