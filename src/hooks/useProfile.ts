import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/use-auth';
import type { Profile } from '@/lib/db/schema';

// Helper to transform snake_case to camelCase
// Duplicated for now to avoid circular dependencies if we move it to utilities
const transformProfile = (data: any): Profile | null => {
    if (!data) return null;
    const isSnake = 'full_name' in data || 'avatar_url' in data;

    if (isSnake) {
        return {
            ...data,
            avatarUrl: data.avatar_url,
            fullName: data.full_name,
            bannerUrl: data.banner_url,
            socialLinks: data.social_links || {},
            availabilityStatus: data.availability_status,
            openTo: data.open_to || [],
        } as unknown as Profile;
    }
    return data as Profile;
};

export const useProfile = (usernameOrId?: string, initialData?: Profile | null) => {
    const queryClient = useQueryClient();
    const { user, profile: authProfile } = useAuth();
    const supabase = createClient();

    const targetKey = usernameOrId || user?.id;
    const isMe = user?.id && (targetKey === user.id || (!usernameOrId && user.id));

    // If requesting current user and we have it in context, use that
    const shouldUseContext = isMe && authProfile;
    const hasInitialData = !!initialData;

    const { data: fetchedProfile, isLoading, error } = useQuery({
        queryKey: ['profile', targetKey],
        initialData: initialData,
        queryFn: async () => {
            if (!targetKey) return null;

            // Try fetching by ID first
            let query = supabase.from('profiles').select('*');
            if (targetKey.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                query = query.eq('id', targetKey);
            } else {
                query = query.eq('username', targetKey);
            }

            const { data, error } = await query.single();
            if (error) throw error;
            return transformProfile(data);
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

        const channel = supabase.channel(`profile-${activeProfile.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${activeProfile.id}`
                },
                (payload: any) => {
                    console.log('Realtime profile update (other):', payload);
                    queryClient.invalidateQueries({ queryKey: ['profile', targetKey] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeProfile?.id, queryClient, targetKey, isMe]);

    return {
        profile: activeProfile || null,
        loading: activeLoading,
        error: shouldUseContext ? null : error
    };
};
