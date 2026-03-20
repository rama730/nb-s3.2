import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'

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
    | { kind: 'task'; payload: DbRealtimePayload }

export function subscribeActiveResource(params: {
    supabase: SupabaseClient
    resourceType: ActiveResourceType
    resourceId: string
    bindings: ActiveResourceBinding[]
    onStatus?: (status: string) => void
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

    return channel.subscribe(onStatus)
}

export function subscribeUserNotifications(params: {
    supabase: SupabaseClient
    userId: string
    onEvent: (event: UserNotificationEvent) => void
    onStatus?: (status: string) => void
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
                table: 'connections',
                filter: `addressee_id=eq.${userId}`,
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
