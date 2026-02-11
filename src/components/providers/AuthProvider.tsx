'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/db/schema';

// --- Types ---
interface AuthState {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    isLoading: boolean;
}

interface AuthContextType extends AuthState {
    isAuthenticated: boolean;
    signIn: (email: string, password: string) => Promise<any>;
    signUp: (email: string, password: string, fullName?: string) => Promise<any>;
    signOut: () => Promise<void>;
    signInWithGoogle: () => Promise<any>;
    signInWithGitHub: () => Promise<any>;
    refreshProfile: () => Promise<void>;
}

// --- Context ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Helpers ---
function transformProfile(profile: any): Profile | null {
    if (!profile) return null;
    // If profile is already camelCase (from Drizzle), return it.
    // If it's snake_case (from Supabase Client), map it.
    // Drizzle 'Profile' type expects camelCase keys: fullName, avatarUrl
    
    // Check if it's likely Supabase raw response
    const isSnake = 'full_name' in profile || 'avatar_url' in profile;
    
    if (isSnake) {
        return {
            ...profile,
            avatarUrl: profile.avatar_url,
            fullName: profile.full_name,
            bannerUrl: profile.banner_url,
            // JSON fields need no mapping usually if they are standard in DB
            socialLinks: profile.social_links || {},
            availabilityStatus: profile.availability_status,
            openTo: profile.open_to || [],
            // Ensure all required fields from Profile type are present
            // We cast because we know the shape matches roughly
        } as unknown as Profile;
    }
    
    return profile as Profile;
}

// --- Provider ---
export function AuthProvider({
    children,
    initialUser,
    initialProfile
}: {
    children: React.ReactNode;
    initialUser: User | null;
    initialProfile: any | null;
}) {
    const [state, setState] = useState<AuthState>({
        user: initialUser,
        session: null, // session will be populated by client-side listener
        profile: initialProfile ? transformProfile(initialProfile) : null,
        isLoading: false, // Initialized immediately with server data
    });
    const activeUserIdRef = useRef<string | null>(initialUser?.id || null);
    const router = useRouter();

    // Sync with Supabase Auth Listener
    useEffect(() => {
        const supabase = createClient();
        let cancelled = false;

        const loadProfile = async (userId: string) => {
            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();
            return transformProfile(profile);
        };
        
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event: string, session: Session | null) => {
                if (cancelled) return;
                if (event === 'SIGNED_IN' && session) {
                    if (session.user.id !== activeUserIdRef.current) {
                        const profile = await loadProfile(session.user.id);
                        if (cancelled) return;
                        activeUserIdRef.current = session.user.id;
                        setState({
                            user: session.user,
                            session,
                            profile,
                            isLoading: false
                        });
                        router.refresh();
                        return;
                    }

                    setState(prev => ({
                        ...prev,
                        user: session.user,
                        session,
                        isLoading: false
                    }));
                } else if (event === 'SIGNED_OUT') {
                    activeUserIdRef.current = null;
                    setState({
                        user: null,
                        session: null,
                        profile: null,
                        isLoading: false
                    });
                    router.refresh();
                } else if (event === 'USER_UPDATED' && session) {
                    const profile = await loadProfile(session.user.id);
                    if (cancelled) return;
                    activeUserIdRef.current = session.user.id;

                    setState(prev => ({
                        ...prev,
                        user: session.user,
                        session,
                        profile: profile || prev.profile,
                        isLoading: false
                    }));
                } else if (event === 'TOKEN_REFRESHED' && session) {
                    activeUserIdRef.current = session.user.id;
                    setState(prev => ({ ...prev, session, user: session.user }));
                }
            }
        );

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, [router]);

    // --- Actions ---
    const signIn = useCallback(async (email: string, password: string) => {
        const supabase = createClient();
        return await supabase.auth.signInWithPassword({ email, password });
    }, []);

    const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
        const supabase = createClient();
        return await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName || '',
                }
            }
        });
    }, []);

    const signInWithGoogle = useCallback(async () => {
        const supabase = createClient();
        return await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
    }, []);

    const signInWithGitHub = useCallback(async () => {
        const supabase = createClient();
        return await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
    }, []);

    const signOut = useCallback(async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        // State update handled by onAuthStateChange, but we can optimise responsiveness
        setState({
            user: null,
            session: null,
            profile: null,
            isLoading: false
        });
    }, []);

    const refreshProfile = useCallback(async () => {
        const supabase = createClient();
        const currentUser = state.user; // Use current state user
        if (!currentUser) return;

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (profile) {
            setState(prev => ({ ...prev, profile: transformProfile(profile) }));
        }
    }, [state.user]);


    const value = {
        ...state,
        isAuthenticated: !!state.user,
        signIn,
        signUp,
        signOut,
        signInWithGoogle,
        signInWithGitHub,
        refreshProfile
    };

    return (
        <AuthContext.Provider value={value as any}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
}
