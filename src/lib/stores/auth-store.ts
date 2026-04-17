import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile } from '@/lib/db/schema'

interface AuthState {
    user: User | null
    session: Session | null
    profile: Profile | null
    isLoading: boolean
    isInitialized: boolean

    // Actions
    setUser: (user: User | null) => void
    setSession: (session: Session | null) => void
    setProfile: (profile: Profile | null) => void
    setLoading: (loading: boolean) => void
    setInitialized: (initialized: boolean) => void
    reset: () => void
}

const initialState = {
    user: null,
    session: null,
    profile: null,
    isLoading: true,
    isInitialized: false,
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            ...initialState,

            setUser: (user) => set({ user }),
            setSession: (session) => set({ session }),
            setProfile: (profile) => set({ profile }),
            setLoading: (isLoading) => set({ isLoading }),
            setInitialized: (isInitialized) => set({ isInitialized }),
            reset: () => set(initialState),
        }),
        {
            name: 'edge-auth-store',
            // SEC-M7: only persist the minimum needed to hydrate the UI
            // before Supabase's cookie-based auth rehydrates. In particular:
            //   - `session` is NEVER persisted (access/refresh tokens).
            //   - `app_metadata` is stripped from `user` so an XSS read of
            //     localStorage cannot identify privileged accounts by role.
            //   - `user_metadata` is stripped so user-controlled keys cannot
            //     widen the attack surface.
            //   - `aud`, `confirmation_sent_at`, and other internals are
            //     stripped for the same reason.
            partialize: (state) => ({
                user: state.user
                    ? {
                        id: state.user.id,
                        email: state.user.email ?? null,
                        created_at: state.user.created_at,
                    }
                    : null,
                profile: state.profile
                    ? {
                        id: state.profile.id,
                        username: state.profile.username,
                        fullName: state.profile.fullName,
                        avatarUrl: state.profile.avatarUrl,
                    }
                    : null,
            }),
        }
    )
)
