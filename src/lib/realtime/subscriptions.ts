import {
    REALTIME_SUBSCRIBE_STATES,
    type RealtimeChannel,
    type RealtimePostgresChangesPayload,
    type SupabaseClient,
} from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { isPrivateRealtimeAuthorizationEnabled } from '@/lib/realtime/authorization'

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
    | 'message_work_links'
    | 'profile'
    | 'project_files'
    | 'project_hydration'
    | 'project_workflow'
    | 'task'
    | 'task_comments'
    | 'task_counts'
    | 'workspace'

export type UserNotificationEvent =
    | { kind: 'profile'; payload: DbRealtimePayload }
    | { kind: 'notification'; payload: DbRealtimePayload }

export type MessagingNotificationEvent =
    | { kind: 'conversation_participant'; payload: DbRealtimePayload }
    | { kind: 'message_visibility'; payload: DbRealtimePayload }

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
    const channelName = `active-resource:${resourceType}:${resourceId}`

    const existingChannel = supabase.getChannels().find(
        (ch) => ch.topic === `realtime:${channelName}` || ch.topic === channelName
    )
    if (existingChannel) {
        void supabase.removeChannel(existingChannel)
    }

    let channel = supabase.channel(channelName)
    const groupedBindings = new Map<string, ActiveResourceBinding[]>()

    for (const binding of bindings) {
        const groupKey = `${binding.table}\u0000${binding.filter ?? ""}`
        const group = groupedBindings.get(groupKey)
        if (group) {
            group.push(binding)
        } else {
            groupedBindings.set(groupKey, [binding])
        }
    }

    for (const grouped of groupedBindings.values()) {
        const [firstBinding] = grouped
        if (!firstBinding) continue
        const event = grouped.length === 1 ? firstBinding.event : "*"
        channel = channel.on(
            'postgres_changes' as any,
            {
                event,
                schema: 'public',
                table: firstBinding.table,
                ...(firstBinding.filter ? { filter: firstBinding.filter } : {}),
            },
            (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
                const eventType = payload.eventType as DbRealtimeEventType | undefined
                for (const binding of grouped) {
                    if (binding.event === "*" || binding.event === eventType) {
                        binding.handler(payload as DbRealtimePayload)
                    }
                }
            },
        )
    }

    return channel.subscribe((status, err) => {
        if (err) {
            logger.error('realtime.subscription.error', {
                module: 'realtime',
                resourceType,
                resourceId,
                error: err instanceof Error
                    ? err.message
                    : (typeof err === 'object' && err
                        ? (err as any).message || JSON.stringify(err)
                        : String(err)),
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
        resourceType: 'profile',
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
                table: 'user_notifications',
                filter: `user_id=eq.${userId}`,
                handler: (payload) => onEvent({ kind: 'notification', payload }),
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
        ],
        onStatus,
    })
}

export function subscribeProjectStage(params: {
    supabase: SupabaseClient
    projectId: string
    onUpdate: (payload: DbRealtimePayload) => void
    channelScope?: 'project_hydration' | 'project_workflow'
}): RealtimeChannel {
    const { supabase, projectId, onUpdate, channelScope = 'project_hydration' } = params;
    return subscribeActiveResource({
        supabase,
        resourceType: channelScope,
        resourceId: projectId,
        bindings: [
            {
                event: 'UPDATE',
                table: 'projects',
                filter: `id=eq.${projectId}`,
                handler: onUpdate,
            },
        ],
    });
}

export async function subscribeProjectStats(params: {
    supabase: SupabaseClient
    projectId: string
    onInvalidate: () => void
}): Promise<RealtimeChannel | null> {
    const { supabase, projectId, onInvalidate } = params;
    if (!isPrivateRealtimeAuthorizationEnabled()) return null;

    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) return null;
    await supabase.realtime.setAuth(accessToken);

    const channel = supabase.channel(`project-stats:${projectId}`, {
        config: { private: true },
    });
    channel.on("broadcast", { event: "stats_invalidate" }, () => {
        onInvalidate();
    });
    return channel.subscribe();
}
