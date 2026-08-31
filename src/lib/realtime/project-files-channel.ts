import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

import { subscribeActiveResource } from '@/lib/realtime/subscriptions'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFilesChannelOptions {
    projectId: string
    onFileLeaseChange?: () => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
 * Subscribe only to the genuinely project-filterable lease resource.
 * Workspace-wide task-link/version bindings and the unpublished
 * `project_nodes` binding were removed; consumers reconcile bounded folder
 * state on focus and after mutations instead of receiving every workspace
 * event in every open project.
 *
 * Supabase Realtime owns socket reconnect and channel rejoin. This wrapper only
 * reports status and releases its budget marker when the channel is removed.
 *
 * Returns the RealtimeChannel instance. Call `supabase.removeChannel(channel)`
 * to unsubscribe.
 */
export function subscribeProjectFilesChannel(
    supabase: SupabaseClient,
    options: ProjectFilesChannelOptions,
): RealtimeChannel {
    const { projectId, onFileLeaseChange, onStatus } = options

    // Budget enforcement
    if (activeChannelIds.size >= MAX_BACKGROUND_CHANNELS) {
        logger.warn('realtime.project-files-channel.budget-exceeded', {
            module: 'realtime',
            projectId,
            count: activeChannelIds.size,
        })
    }

    const channelId = projectId

    function cleanup() {
        activeChannelIds.delete(channelId)
    }

    const channel = subscribeActiveResource({
        supabase,
        resourceType: 'project_files',
        resourceId: projectId,
        bindings: [
                {
                    event: '*',
                    table: 'project_node_locks',
                    filter: `project_id=eq.${projectId}`,
                    handler: () => onFileLeaseChange?.(),
                },
        ],
        onStatus,
    })

    // Track this channel in the budget
    activeChannelIds.add(channelId)

    // Patch the channel's unsubscribe to also run our cleanup
    const originalUnsubscribe = channel.unsubscribe.bind(channel)
    channel.unsubscribe = () => {
        cleanup()
        return originalUnsubscribe()
    }

    return channel
}
