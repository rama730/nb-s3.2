import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/use-auth';
import type { Profile } from '@/lib/db/schema';
import { normalizeProfile } from '@/lib/utils/normalize-profile';
import { queryKeys } from '@/lib/query-keys';
import { subscribeActiveResource } from '@/lib/realtime/subscriptions';
import { normalizeUsername } from '@/lib/validations/username';

export const useProfile = (usernameOrId?: string, initialData?: Profile | null) => {
    const queryClient = useQueryClient();
    const { user, profile: authProfile } = useAuth();
    const supabase = useMemo(() => createClient(), []);

    const targetKey = usernameOrId || user?.id;
    const isMe = user?.id && (targetKey === user.id || (!usernameOrId && user.id));

    // If requesting current user and we have it in context, use that
    const shouldUseContext = isMe && authProfile;
    const hasInitialData = !!initialData;

    const { data: fetchedProfile, isLoading, error } = useQuery({
        queryKey: queryKeys.profile.byTarget(targetKey || 'unknown'),
        initialData: initialData,
        queryFn: async () => {
            if (!targetKey) return null;

            // Try fetching by ID first
            let query = supabase.from('profiles').select('*');
            if (targetKey.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                query = query.eq('id', targetKey);
            } else {
                query = query.eq('username', normalizeUsername(targetKey));
            }

            const { data, error } = await query.single();
            if (error) throw error;
            return normalizeProfile(data) as Profile | null;
        },
        enabled: !!targetKey && !shouldUseContext, // Don't fetch if we have context
        staleTime: 1000 * 60 * 5,
        refetchOnMount: hasInitialData ? false : true,
        refetchOnWindowFocus: false,
    });

    const activeProfile = shouldUseContext ? authProfile : fetchedProfile;
    const activeLoading = shouldUseContext ? false : isLoading;

    // Real-time subscription (only for OTHER users, as AuthProvider handles ME)
    useEffect(() => {
        if (!activeProfile?.id || isMe) return;

        const channel = subscribeActiveResource({
            supabase,
            resourceType: 'profile',
            resourceId: activeProfile.id,
            bindings: [
                {
                    event: '*',
                    table: 'profiles',
                    filter: `id=eq.${activeProfile.id}`,
                    handler: (payload) => {
                    if (payload?.eventType === 'DELETE') {
                        queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetKey || 'unknown') });
                        return;
                    }

                    const rawProfile = payload?.new as Record<string, unknown> | null | undefined;
                    if (!rawProfile) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetKey || 'unknown') });
                        return;
                    }

                    const normalized = normalizeProfile(rawProfile) as Profile | null;
                    if (!normalized?.id) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetKey || 'unknown') });
                        return;
                    }

                    queryClient.setQueryData(queryKeys.profile.byTarget(targetKey || 'unknown'), normalized);
                    queryClient.setQueryData(queryKeys.profile.byTarget(normalized.id), normalized);
                    if (normalized.username) {
                        queryClient.setQueryData(queryKeys.profile.byTarget(normalized.username), normalized);
                    }
                    },
                },
            ],
        });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeProfile?.id, queryClient, targetKey, isMe, supabase]);

    return {
        profile: activeProfile || null,
        loading: activeLoading,
        error: shouldUseContext ? null : error
    };
};
