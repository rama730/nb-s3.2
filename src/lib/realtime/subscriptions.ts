import {
    REALTIME_SUBSCRIBE_STATES,
    type RealtimeChannel,
    type RealtimePostgresChangesPayload,
    type SupabaseClient,
} from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

type DbRealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE'

export type DbRealtimePayload = Pick<RealtimePostgresChangesPayload<Record<string, unknown>>, 'new' | 'old'> & {
    eventType?: DbRealtimeEventType
}

type ActiveResourceBinding = {
    event: '*' | DbRealtimeEventType
    table: string
    filter?: string
    handler: (payload: DbRealtimePayload) => void
}

export type ActiveResourceType =
    | 'conversation'
    | 'profile'
    | 'task'
    | 'task_comments'
    | 'task_counts'
    | 'workspace'

export type UserNotificationEvent =
    | { kind: 'profile'; payload: DbRealtimePayload }
    | { kind: 'conversation_participant'; payload: DbRealtimePayload }
    | { kind: 'connection'; payload: DbRealtimePayload }
    | { kind: 'message'; payload: DbRealtimePayload }
    | { kind: 'message_visibility'; payload: DbRealtimePayload }
    | { kind: 'task'; payload: DbRealtimePayload }

export type MessagingNotificationEvent =
    | { kind: 'conversation_participant'; payload: DbRealtimePayload }
    | { kind: 'connection'; payload: DbRealtimePayload }
    | { kind: 'message_visibility'; payload: DbRealtimePayload }

export type NotificationInboxEvent = {
    kind: 'notification'
    payload: DbRealtimePayload
}

export function isRealtimeTerminalStatus(status: REALTIME_SUBSCRIBE_STATES) {
    return (
        status === REALTIME_SUBSCRIBE_STATES.CLOSED
        || status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR
        || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    )
}

export function subscribeActiveResource(params: {
    supabase: SupabaseClient
    resourceType: ActiveResourceType
    resourceId: string
    bindings: ActiveResourceBinding[]
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}): RealtimeChannel {
    const { supabase, resourceType, resourceId, bindings, onStatus } = params
    let channel = supabase.channel(`active-resource:${resourceType}:${resourceId}`)

    for (const binding of bindings) {
        channel = channel.on(
            'postgres_changes' as any,
            {
                event: binding.event,
                schema: 'public',
                table: binding.table,
                ...(binding.filter ? { filter: binding.filter } : {}),
            },
            (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
                binding.handler(payload as DbRealtimePayload)
            },
        )
    }

    return channel.subscribe((status, err) => {
        if (err) {
            logger.error('realtime.subscription.error', {
                module: 'realtime',
                resourceType,
                resourceId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        onStatus?.(status);
    })
}

export function subscribeUserNotifications(params: {
    supabase: SupabaseClient
    userId: string
    onEvent: (event: UserNotificationEvent) => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}): RealtimeChannel {
    const { supabase, userId, onEvent, onStatus } = params

    return subscribeActiveResource({
        supabase,
        resourceType: 'workspace',
        resourceId: userId,
        bindings: [
            {
                event: '*',
                table: 'profiles',
                filter: `id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'profile', payload }),
            },
            {
                event: '*',
                table: 'conversation_participants',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'conversation_participant', payload }),
            },
            {
                event: '*',
                table: 'message_hidden_for_users',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'message_visibility', payload }),
            },
            {
                event: '*',
                table: 'connections',
                filter: `addressee_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'connection', payload }),
            },
            {
                event: '*',
                table: 'connections',
                filter: `requester_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'connection', payload }),
            },
            {
                event: '*',
                table: 'tasks',
                filter: `assignee_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'task', payload }),
            },
        ],
        onStatus,
    })
}

export function subscribeMessagingNotifications(params: {
    supabase: SupabaseClient
    userId: string
    onEvent: (event: MessagingNotificationEvent) => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}): RealtimeChannel {
    const { supabase, userId, onEvent, onStatus } = params

    return subscribeActiveResource({
        supabase,
        resourceType: 'workspace',
        resourceId: `messaging:${userId}`,
        bindings: [
            {
                event: '*',
                table: 'conversation_participants',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'conversation_participant', payload }),
            },
            {
                event: '*',
                table: 'message_hidden_for_users',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'message_visibility', payload }),
            },
            {
                event: '*',
                table: 'connections',
                filter: `addressee_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'connection', payload }),
            },
            {
                event: '*',
                table: 'connections',
                filter: `requester_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'connection', payload }),
            },
        ],
        onStatus,
    })
}

export function subscribeNotificationInbox(params: {
    supabase: SupabaseClient
    userId: string
    onEvent: (event: NotificationInboxEvent) => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}): RealtimeChannel {
    const { supabase, userId, onEvent, onStatus } = params

    return subscribeActiveResource({
        supabase,
        resourceType: 'workspace',
        resourceId: `notification-inbox:${userId}`,
        bindings: [
            {
                event: '*',
                table: 'user_notifications',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'notification', payload }),
            },
        ],
        onStatus,
    })
}
