'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { getAuthHardeningPhase } from '@/lib/auth/hardening';
import { buildOAuthRedirectTo, normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects';
import { continueBrowserOAuthRedirect } from '@/lib/auth/oauth';
import { resetMonotonicEntity, runMonotonicUpdate } from '@/lib/state/monotonic';

const AUTH_SIGN_IN_TIMEOUT_MS = 8_000;
const AUTH_UNREACHABLE_MESSAGE = 'Authentication service is unavailable. Check your Supabase connection and try again.';
function createAuthRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Types ---
interface AuthState {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    isLoading: boolean;
}

interface AuthResult {
    data: { user: User | null; session: Session | null } | null;
    error: { message: string } | null;
}

interface OAuthResult {
    data: { url: string } | null;
    error: { message: string } | null;
}

interface AuthContextType extends AuthState {
    isAuthenticated: boolean;
    signIn: (email: string, password: string, captchaToken?: string) => Promise<AuthResult>;
    signUp: (email: string, password: string, fullName?: string, captchaToken?: string) => Promise<AuthResult>;
    signOut: () => Promise<void>;
    signInWithGoogle: (nextPath?: string | null) => Promise<OAuthResult>;
    signInWithGitHub: (nextPath?: string | null) => Promise<OAuthResult>;
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
            messagePrivacy: profile.message_privacy,
            connectionPrivacy: profile.connection_privacy,
            openTo: profile.open_to || [],
            experienceLevel: profile.experience_level,
            hoursPerWeek: profile.hours_per_week,
            genderIdentity: profile.gender_identity,
            connectionsCount: profile.connections_count ?? 0,
            projectsCount: profile.projects_count ?? 0,
            followersCount: profile.followers_count ?? 0,
            workspaceInboxCount: profile.workspace_inbox_count ?? 0,
            workspaceDueTodayCount: profile.workspace_due_today_count ?? 0,
            workspaceOverdueCount: profile.workspace_overdue_count ?? 0,
            workspaceInProgressCount: profile.workspace_in_progress_count ?? 0,
            securityRecoveryCodes: profile.security_recovery_codes ?? [],
            recoveryCodesGeneratedAt: profile.recovery_codes_generated_at,
            createdAt: profile.created_at ? new Date(profile.created_at) : undefined,
            updatedAt: profile.updated_at ? new Date(profile.updated_at) : undefined,
            deletedAt: profile.deleted_at ? new Date(profile.deleted_at) : undefined,
            // Ensure all required fields from Profile type are present
            // We cast because we know the shape matches roughly
        } as unknown as Profile;
    }
    
    return profile as Profile;
}

function profileNeedsHydration(profile: any): boolean {
    if (!profile || typeof profile !== 'object') return false;
    const experience = profile.experience ?? profile.experience_data;
    const education = profile.education ?? profile.education_data;

    return (
        experience === undefined
        || education === undefined
    );
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
    const MONOTONIC_AUTH_KEY = 'auth-provider:state';
    const [state, setState] = useState<AuthState>({
        user: initialUser,
        session: null, // session will be populated by client-side listener
        profile: initialProfile ? transformProfile(initialProfile) : null,
        isLoading: false, // Initialized immediately with server data
    });
    const activeUserIdRef = useRef<string | null>(initialUser?.id || null);
    const authEventVersionRef = useRef(0);
    const bootstrapHydrationPendingRef = useRef(Boolean(initialUser) && (!initialProfile || profileNeedsHydration(initialProfile)));
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
                const eventVersion = ++authEventVersionRef.current;
                if (cancelled) return;
                if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
                    if (session.user.id !== activeUserIdRef.current) {
                        const profile = await loadProfile(session.user.id);
                        if (cancelled || eventVersion !== authEventVersionRef.current) return;
                        const applied = runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                            activeUserIdRef.current = session.user.id;
                            setState({
                                user: session.user,
                                session,
                                profile,
                                isLoading: false
                            });
                        });
                        if (applied === null) return;
                        if (event === 'SIGNED_IN') {
                            router.refresh();
                        }
                        return;
                    }

                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        setState(prev => ({
                            ...prev,
                            user: session.user,
                            session,
                            isLoading: false
                        }));
                    });
                } else if (event === 'INITIAL_SESSION' && !session) {
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = null;
                        setState({
                            user: null,
                            session: null,
                            profile: null,
                            isLoading: false,
                        });
                    });
                } else if (event === 'SIGNED_OUT') {
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = null;
                        setState({
                            user: null,
                            session: null,
                            profile: null,
                            isLoading: false
                        });
                    });
                    router.refresh();
                } else if (event === 'USER_UPDATED' && session) {
                    const profile = await loadProfile(session.user.id);
                    if (cancelled || eventVersion !== authEventVersionRef.current) return;
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = session.user.id;

                        setState(prev => ({
                            ...prev,
                            user: session.user,
                            session,
                            profile: profile || prev.profile,
                            isLoading: false
                        }));
                    });
                } else if (event === 'TOKEN_REFRESHED' && session) {
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = session.user.id;
                        setState(prev => ({ ...prev, session, user: session.user }));
                    });
                }
            }
        );

        return () => {
            cancelled = true;
            subscription.unsubscribe();
            resetMonotonicEntity(MONOTONIC_AUTH_KEY);
        };
    }, [router]);

    // --- Actions ---
    const signIn = useCallback(async (email: string, password: string, captchaToken?: string) => {
        const supabase = createClient();
        try {
            const result = await Promise.race([
                supabase.auth.signInWithPassword({
                    email,
                    password,
                    options: captchaToken ? { captchaToken } : undefined,
                }),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('AUTH_TIMEOUT')), AUTH_SIGN_IN_TIMEOUT_MS);
                }),
            ]);
            if (!result.error) return result;

            const message = (result.error.message || '').toLowerCase();
            const isConnectivityError = message.includes('fetch failed') || message.includes('timeout');
            if (isConnectivityError) {
                return {
                    data: null,
                    error: { message: AUTH_UNREACHABLE_MESSAGE },
                };
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            const isConnectivityError = message === 'AUTH_TIMEOUT' || message.toLowerCase().includes('fetch failed');
            if (isConnectivityError) {
                return {
                    data: null,
                    error: { message: AUTH_UNREACHABLE_MESSAGE },
                };
            }
            return {
                data: null,
                error: { message: 'Sign in failed' },
            };
        }
    }, []);

    const signUp = useCallback(async (email: string, password: string, fullName?: string, captchaToken?: string) => {
        const supabase = createClient();
        return await supabase.auth.signUp({
            email,
            password,
            options: {
                ...(captchaToken ? { captchaToken } : {}),
                data: {
                    full_name: fullName || '',
                }
            }
        });
    }, []);

    const signInWithGoogle = useCallback(async (nextPath?: string | null) => {
        const supabase = createClient();
        const normalizedNextPath = normalizeAuthNextPath(nextPath);
        const baseUrl = resolveAuthBaseUrl();
        const oauthRequestId = createAuthRequestId();
        const hardeningPhase = getAuthHardeningPhase();
        const redirectTo = buildOAuthRedirectTo(baseUrl, normalizedNextPath, oauthRequestId, 'google');
        logger.metric('auth.oauth.start', {
            requestId: oauthRequestId,
            provider: 'google',
            nextPath: normalizedNextPath,
            baseUrl,
            phase: hardeningPhase,
        });
        const result = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo },
        });
        if (!result.error) {
            continueBrowserOAuthRedirect(result);
        }
        return result;
    }, []);

    const signInWithGitHub = useCallback(async (nextPath?: string | null) => {
        const supabase = createClient();
        const normalizedNextPath = normalizeAuthNextPath(nextPath);
        const baseUrl = resolveAuthBaseUrl();
        const oauthRequestId = createAuthRequestId();
        const hardeningPhase = getAuthHardeningPhase();
        const redirectTo = buildOAuthRedirectTo(baseUrl, normalizedNextPath, oauthRequestId, 'github');
        logger.metric('auth.oauth.start', {
            requestId: oauthRequestId,
            provider: 'github',
            nextPath: normalizedNextPath,
            baseUrl,
            phase: hardeningPhase,
        });
        const result = await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: { redirectTo },
        });
        if (!result.error) {
            continueBrowserOAuthRedirect(result);
        }
        return result;
    }, []);

    const signOut = useCallback(async () => {
        const supabase = createClient();
        await supabase.auth.signOut().catch(() => null);
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

    useEffect(() => {
        if (!bootstrapHydrationPendingRef.current || !state.user) return;

        let cancelled = false;
        const hydrate = () => {
            if (cancelled) return;
            bootstrapHydrationPendingRef.current = false;
            void refreshProfile();
        };

        const requestIdle = (window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        }).requestIdleCallback;
        if (typeof requestIdle === 'function') {
            const handle = requestIdle(hydrate, { timeout: 1_500 });
            return () => {
                cancelled = true;
                const cancelIdle = (window as Window & {
                    cancelIdleCallback?: (handle: number) => void;
                }).cancelIdleCallback;
                if (typeof cancelIdle === 'function') {
                    cancelIdle(handle);
                }
            };
        }

        const timer = window.setTimeout(hydrate, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [refreshProfile, state.user]);


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
