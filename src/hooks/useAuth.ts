import { useAuth as useAuthContext } from '@/lib/hooks/use-auth';

/**
 * Backward-compatible auth hook used by legacy components.
 * Keeps `isSignedIn` and hydrated metadata while using the real auth context.
 */
export function useAuth() {
    const auth = useAuthContext();
    const hydratedUser = auth.user && auth.profile
        ? {
            ...auth.user,
            user_metadata: {
                ...(auth.user.user_metadata || {}),
                username: auth.profile.username || undefined,
                full_name: auth.profile.fullName || undefined,
                avatar_url: auth.profile.avatarUrl || undefined,
            },
        }
        : auth.user;

    return {
        ...auth,
        user: hydratedUser,
        isSignedIn: auth.isAuthenticated,
    };
}
